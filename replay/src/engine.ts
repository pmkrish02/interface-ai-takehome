import { chromium } from "playwright";
import type { Artifact, ReplayResult, Step } from "@interface-takehome/shared";
import { classifyPage } from "./knownOutcome";
import { executeStep } from "./executor";
import { attemptRecovery } from "./recovery";
import { escalate } from "./escalation";
import { evidenceDirs, saveScreenshot } from "./evidence";
import { verifyCheckpoint, describeCheckpoint } from "./checkpoint";
import { capturePageText } from "./pageState";
import { normalizeParams } from "./validate";
import { describeClassification, ReplayEvidenceWriter } from "./replayEvidence";
import type { EscalationResolution } from "./types";

export interface ReplayOptions {
  evidenceRoot: string;
  headless?: boolean; // default false — a human may need to take control of this exact window
}

function describeStep(step: Step, index: number): string {
  switch (step.action) {
    case "navigate":
      return `step ${index} (navigate to ${step.url}) to succeed`;
    case "click":
      return `step ${index} (click) to succeed`;
    case "type":
      return `step ${index} (type into "${step.param}") to succeed`;
    case "extract":
      return `step ${index} (extract "${step.output}") to succeed`;
  }
}

type ResolutionOutcome =
  | { type: "return"; result: ReplayResult }
  | { type: "advance" }
  | { type: "proceed" };

async function hardFailureResult(
  page: import("playwright").Page,
  screenshotDir: string,
  step: number,
  expected: string,
  observed: string
): Promise<ReplayResult> {
  await saveScreenshot(page, screenshotDir, `hard-failure-step${step}`);
  return { status: "hard_failure", step, expected, observed };
}

async function runReplayCore(
  artifact: Artifact,
  params: Record<string, string>,
  options: ReplayOptions,
  logger: ReplayEvidenceWriter
): Promise<ReplayResult> {
  const { escalations } = evidenceDirs(options.evidenceRoot);

  const browser = await chromium.launch({ headless: false, slowMo: 1000 });
  const page = await browser.newPage();
  const outputs: Record<string, string> = {};

  // Handles an escalation's resolution when the pause happened BEFORE
  // executing a risky step: recovery just heals the session so the risky
  // action can still be performed by replay ("proceed"); everything else
  // is a terminal or skip-forward outcome.
  async function handleRiskyEscalation(
    resolution: EscalationResolution,
    stepIndex: number
  ): Promise<ResolutionOutcome> {
    switch (resolution.kind) {
      case "success":
        return { type: "return", result: { status: "success", outputs } };
      case "business_outcome":
        return { type: "return", result: { status: "business_outcome", outcome: resolution.outcome.name } };
      case "hard_failure":
        return {
          type: "return",
          result: await hardFailureResult(
            page,
            escalations,
            stepIndex,
            "operator to resolve the risky-step review",
            resolution.outcome.match
          ),
        };
      case "recoverable":
        await attemptRecovery(page, resolution.outcome.action!, artifact, params);
        return { type: "proceed" };
      case "continue":
        return { type: "advance" };
    }
  }

  // Handles an escalation's resolution when the pause happened AFTER a step
  // failed to reach a known-good state. Always terminal or skip-forward —
  // the retry budget for this step is already spent by the time we get here.
  async function handleFailureEscalation(
    resolution: EscalationResolution,
    stepIndex: number
  ): Promise<ResolutionOutcome> {
    switch (resolution.kind) {
      case "success":
        return { type: "return", result: { status: "success", outputs } };
      case "business_outcome":
        return { type: "return", result: { status: "business_outcome", outcome: resolution.outcome.name } };
      case "hard_failure":
        return {
          type: "return",
          result: await hardFailureResult(
            page,
            escalations,
            stepIndex,
            "operator to resolve the failure",
            resolution.outcome.match
          ),
        };
      case "recoverable": {
        await attemptRecovery(page, resolution.outcome.action!, artifact, params);
        const after = await classifyPage(page, artifact);
        if (after.kind === "success") return { type: "return", result: { status: "success", outputs } };
        if (after.kind === "business_outcome")
          return { type: "return", result: { status: "business_outcome", outcome: after.outcome.name } };
        return {
          type: "return",
          result: await hardFailureResult(
            page,
            escalations,
            stepIndex,
            "recovery to resolve the outcome after escalation",
            after.kind === "hard_failure_outcome" || after.kind === "recoverable"
              ? after.outcome.match
              : await capturePageText(page)
          ),
        };
      }
      case "continue":
        return { type: "advance" };
    }
  }

  try {
    let i = 0;
    while (i < artifact.steps.length) {
      const step = artifact.steps[i];

      if (step.risky) {
        const resolution = await escalate(
          page,
          artifact,
          `About to execute risky step ${i} (${step.action}). Review and confirm before continuing.`,
          i,
          null,
          null,
          escalations
        );
        const outcome = await handleRiskyEscalation(resolution, i);
        logger.logStep({ stepIndex: i, action: step.action, note: "risky-preflight", classification: resolution.kind });
        if (outcome.type === "return") return outcome.result;
        if (outcome.type === "advance") {
          i++;
          continue;
        }
        // "proceed": fall through and execute the step below.
      }

      const execResult = await executeStep(page, step, params);
      logger.logStep({
        stepIndex: i,
        action: step.action,
        paramRef: step.action === "type" ? step.param : undefined,
        outputRef: step.action === "extract" ? step.output : undefined,
        tier: execResult.tier,
        execSuccess: execResult.success,
        execError: execResult.error,
      });
      if (execResult.success && step.action === "extract" && step.output) {
        outputs[step.output] = execResult.extractedValue ?? "";
      }

      // Only the final step's classification is allowed to conclude
      // "success" — successCheckpoint text can already be on the page
      // before every step has run (see classifyPage docs).
      const isLastStep = i === artifact.steps.length - 1;
      let classification = await classifyPage(page, artifact, isLastStep);
      logger.logStep({
        stepIndex: i,
        action: step.action,
        note: "classification",
        classification: describeClassification(classification),
      });

      if (classification.kind === "recoverable") {
        // "execute recovery, re-attempt current step once" (spec).
        await attemptRecovery(page, classification.outcome.action!, artifact, params);
        const retryResult = await executeStep(page, step, params);
        logger.logStep({
          stepIndex: i,
          action: step.action,
          note: "recoverable-retry",
          paramRef: step.action === "type" ? step.param : undefined,
          outputRef: step.action === "extract" ? step.output : undefined,
          tier: retryResult.tier,
          execSuccess: retryResult.success,
          execError: retryResult.error,
        });
        if (retryResult.success && step.action === "extract" && step.output) {
          outputs[step.output] = retryResult.extractedValue ?? "";
        }
        classification = await classifyPage(page, artifact, isLastStep);
        logger.logStep({
          stepIndex: i,
          action: step.action,
          note: "recoverable-retry-classification",
          classification: describeClassification(classification),
        });
        if (classification.kind === "success") return { status: "success", outputs };
        if (classification.kind === "business_outcome")
          return { status: "business_outcome", outcome: classification.outcome.name };
        // Still unresolved after the one allowed retry — escalate.
        const observed =
          classification.kind === "hard_failure_outcome" || classification.kind === "recoverable"
            ? classification.outcome.match
            : retryResult.error ?? (await capturePageText(page)).slice(0, 300);
        const resolution = await escalate(
          page,
          artifact,
          `Recoverable outcome unresolved after retry at step ${i}`,
          i,
          describeStep(step, i),
          observed,
          escalations
        );
        const outcome = await handleFailureEscalation(resolution, i);
        if (outcome.type === "return") return outcome.result;
        i++;
        continue;
      }

      if (classification.kind === "success") {
        return { status: "success", outputs };
      }

      if (classification.kind === "business_outcome") {
        return { status: "business_outcome", outcome: classification.outcome.name };
      }

      if (classification.kind === "hard_failure_outcome") {
        const resolution = await escalate(
          page,
          artifact,
          `Hard-failure outcome "${classification.outcome.name}" at step ${i}`,
          i,
          describeStep(step, i),
          classification.outcome.match,
          escalations
        );
        const outcome = await handleFailureEscalation(resolution, i);
        if (outcome.type === "return") return outcome.result;
        i++;
        continue;
      }

      // unclassified: nothing recognized the page as good or bad.
      if (!execResult.success) {
        const resolution = await escalate(
          page,
          artifact,
          `Step ${i} (${step.action}) failed to execute: ${execResult.error}`,
          i,
          describeStep(step, i),
          execResult.error ?? "unknown execution error",
          escalations
        );
        const outcome = await handleFailureEscalation(resolution, i);
        if (outcome.type === "return") return outcome.result;
        i++;
        continue;
      }

      if (step.checkpoint) {
        const ok = await verifyCheckpoint(page, step.checkpoint);
        if (!ok) {
          const resolution = await escalate(
            page,
            artifact,
            `Step ${i} checkpoint failed: ${describeCheckpoint(step.checkpoint)}`,
            i,
            describeCheckpoint(step.checkpoint),
            (await capturePageText(page)).slice(0, 300),
            escalations
          );
          const outcome = await handleFailureEscalation(resolution, i);
          if (outcome.type === "return") return outcome.result;
          i++;
          continue;
        }
      }

      i++;
    }

    // All steps ran without an early return, but successCheckpoint never
    // matched at any point along the way — per spec point 3, escalate.
    const finalCheck = await classifyPage(page, artifact);
    logger.logStep({
      stepIndex: artifact.steps.length - 1,
      action: artifact.steps[artifact.steps.length - 1].action,
      note: "final-check",
      classification: describeClassification(finalCheck),
    });
    if (finalCheck.kind === "success") return { status: "success", outputs };
    if (finalCheck.kind === "business_outcome")
      return { status: "business_outcome", outcome: finalCheck.outcome.name };
    if (finalCheck.kind === "recoverable") {
      await attemptRecovery(page, finalCheck.outcome.action!, artifact, params);
      const after = await classifyPage(page, artifact);
      logger.logStep({
        stepIndex: artifact.steps.length - 1,
        action: artifact.steps[artifact.steps.length - 1].action,
        note: "final-check-after-recovery",
        classification: describeClassification(after),
      });
      if (after.kind === "success") return { status: "success", outputs };
      if (after.kind === "business_outcome") return { status: "business_outcome", outcome: after.outcome.name };
    }

    const resolution = await escalate(
      page,
      artifact,
      "Replay finished all steps but the final state does not match successCheckpoint",
      artifact.steps.length - 1,
      describeCheckpoint(artifact.successCheckpoint),
      (await capturePageText(page)).slice(0, 300),
      escalations
    );
    if (resolution.kind === "success") return { status: "success", outputs };
    if (resolution.kind === "business_outcome")
      return { status: "business_outcome", outcome: resolution.outcome.name };

    const observed =
      resolution.kind === "hard_failure" || resolution.kind === "recoverable"
        ? resolution.outcome.match
        : (await capturePageText(page)).slice(0, 300);
    return await hardFailureResult(
      page,
      escalations,
      artifact.steps.length - 1,
      describeCheckpoint(artifact.successCheckpoint),
      observed
    );
  } finally {
    await browser.close();
  }
}

/**
 * Public entry point. Wraps runReplayCore purely for evidence: validates
 * params, times the run, and writes one summary JSON no matter which path
 * runReplayCore took to its result (or if it threw) — none of the
 * classification/escalation logic above is touched by this wrapper.
 */
export async function runReplay(
  artifact: Artifact,
  rawParams: Record<string, unknown>,
  options: ReplayOptions
): Promise<ReplayResult> {
  const params = normalizeParams(artifact, rawParams);
  const logger = new ReplayEvidenceWriter(options.evidenceRoot, artifact);

  let result: ReplayResult | undefined;
  try {
    result = await runReplayCore(artifact, params, options, logger);
    return result;
  } catch (e) {
    result = {
      status: "hard_failure",
      step: -1,
      expected: "replay to complete without throwing",
      observed: (e as Error).message,
    };
    throw e;
  } finally {
    logger.writeSummary(params, result ?? { status: "hard_failure", step: -1, expected: "unknown", observed: "unknown" });
  }
}
