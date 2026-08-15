import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";
import type { Artifact } from "@interface-takehome/shared";
import { captureA11yTree, digestA11yTree } from "./accessibility";
import { getGeminiApiKey } from "./env";
import { createGeminiDecider } from "./gemini";
import { executeAction } from "./executor";
import { EvidenceWriter } from "./evidence";
import { ArtifactRecorder } from "./recorder";
import { createParamInferrer } from "./paramInference";
import type { ActionTarget, DiscoveryConfig, ModelAction, TurnRecord } from "./types";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function summarize(action: ModelAction): string {
  switch (action.action) {
    case "navigate":
      return `navigate to ${action.url}`;
    case "click":
      return `click ${describeTarget(action.target)}`;
    case "type":
      return `type into ${describeTarget(action.target)}`;
    case "extract":
      return `extract "${action.outputName}" from ${describeTarget(action.target)}`;
    case "done":
      return `done: ${action.reason}`;
  }
}

function describeTarget(target: ActionTarget): string {
  return target.by === "role"
    ? `role=${target.role} name="${target.name}"`
    : `${target.by}="${target.text}"`;
}

export interface DiscoveryRunResult {
  artifact: Artifact;
  artifactsDir: string;
  stopReason: "done" | "max_steps" | "parse_error" | "execution_error";
}

export async function runDiscovery(
  config: DiscoveryConfig,
  evidenceRoot: string
): Promise<DiscoveryRunResult> {
  const apiKey = getGeminiApiKey();
  const decider = createGeminiDecider(apiKey, config.credentials);
  const evidence = new EvidenceWriter(evidenceRoot, config.credentials);
  const recorder = new ArtifactRecorder(config);
  const paramInferrer = createParamInferrer(config.goal, config.credentials);

  const browser = await chromium.launch({ headless: config.headless });
  const page = await browser.newPage();

  const history: string[] = [];
  let stopReason: DiscoveryRunResult["stopReason"] = "max_steps";
  let finalUrl = config.baseUrl;

  try {
    await page.goto(config.baseUrl, { waitUntil: "load" });
    recorder.recordNavigate(config.baseUrl);
    history.push(`navigate to ${config.baseUrl}`);
    finalUrl = page.url();

    for (let turn = 1; turn <= config.maxSteps; turn++) {
      const a11yTree = await captureA11yTree(page);
      const url = page.url();
      const turnRecord: Partial<TurnRecord> = {
        turn,
        goal: config.goal,
        url,
        a11yDigest: digestA11yTree(a11yTree),
        timestampMs: Date.now(),
      };

      let action: ModelAction;
      try {
        action = await withTimeout(
          decider.decide({
            goal: config.goal,
            url,
            a11yTree,
            history,
            stepsRemaining: config.maxSteps - turn + 1,
          }),
          config.perStepTimeoutMs,
          "model decision"
        );
      } catch (e) {
        evidence.appendTurn({
          ...(turnRecord as TurnRecord),
          modelAction: null,
          execution: { success: false, error: (e as Error).message },
        });
        await evidence.saveFailureScreenshot(page, turn);
        stopReason = "parse_error";
        break;
      }

      if (action.action === "done") {
        evidence.appendTurn({
          ...(turnRecord as TurnRecord),
          modelAction: action,
          execution: { success: true },
        });
        stopReason = "done";
        break;
      }

      const outcome = await withTimeout(
        executeAction(page, action),
        config.perStepTimeoutMs,
        "action execution"
      ).catch((e: Error) => ({ result: { success: false, error: e.message } }) as const);

      evidence.appendTurn({
        ...(turnRecord as TurnRecord),
        modelAction: action,
        execution: outcome.result,
      });

      if (!outcome.result.success) {
        await evidence.saveFailureScreenshot(page, turn);
        stopReason = "execution_error";
        break;
      }

      recordSuccessfulStep(recorder, paramInferrer, action, outcome);
      history.push(summarize(action));
      finalUrl = page.url();
    }
  } catch (e) {
    // Unexpected error outside the per-turn try/catch already handled above
    // (e.g. the initial navigation to baseUrl failing).
    await evidence.saveFailureScreenshot(page, 0);
    stopReason = "execution_error";
    throw e;
  } finally {
    await browser.close();
  }

  const artifact = recorder.finalize(finalUrl);

  const artifactsDir = path.join(evidenceRoot, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, `${artifact.name}.json`),
    JSON.stringify(artifact, null, 2)
  );

  return { artifact, artifactsDir, stopReason };
}

function recordSuccessfulStep(
  recorder: ArtifactRecorder,
  paramInferrer: ReturnType<typeof createParamInferrer>,
  action: ModelAction,
  outcome: Awaited<ReturnType<typeof executeAction>>
): void {
  switch (action.action) {
    case "navigate":
      recorder.recordNavigate(action.url);
      return;
    case "click":
      recorder.recordClick(outcome.locatorChain);
      return;
    case "type": {
      const paramName = paramInferrer.nameFor(action.value);
      recorder.recordType(paramName, outcome.locatorChain);
      return;
    }
    case "extract":
      recorder.recordExtract(action.outputName, outcome.locatorChain, outcome.result.extractedValue ?? "");
      return;
    case "done":
      return;
  }
}
