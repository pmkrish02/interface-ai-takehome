import * as readline from "readline";
import type { Page } from "playwright";
import type { Artifact } from "@interface-takehome/shared";
import { appendPostHandoff, saveScreenshot, writeEscalationFile } from "./evidence";
import { captureA11yTree } from "./pageState";
import { classifyPage } from "./knownOutcome";
import type { EscalationResolution } from "./types";

function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Pauses replay and hands the SAME open browser window to a human. Used
 * both before a `risky` step (approve/perform it manually) and after an
 * unresolved failure (fix the underlying problem by hand). Section 3.6.
 */
export async function escalate(
  page: Page,
  artifact: Artifact,
  reason: string,
  stepIndex: number,
  expected: string | null,
  observed: string | null,
  escalationsDir: string
): Promise<EscalationResolution> {
  const screenshotPath = await saveScreenshot(page, escalationsDir, `escalation-step${stepIndex}`);
  const file = writeEscalationFile(escalationsDir, {
    timestamp: new Date().toISOString(),
    artifact: artifact.name,
    stepIndex,
    reason,
    expected,
    observed,
    url: page.url(),
    screenshotPath,
  });

  console.log(
    `\nEscalation: ${reason}. Operator, take control of the browser now (already open), then press Enter to resume.\n(evidence: ${file})`
  );
  await waitForEnter("> ");

  appendPostHandoff(file, {
    url: page.url(),
    a11ySnapshot: await captureA11yTree(page),
  });

  const classification = await classifyPage(page, artifact);
  switch (classification.kind) {
    case "success":
      return { kind: "success" };
    case "business_outcome":
      return { kind: "business_outcome", outcome: classification.outcome };
    case "recoverable":
      return { kind: "recoverable", outcome: classification.outcome };
    case "hard_failure_outcome":
      return { kind: "hard_failure", outcome: classification.outcome };
    case "unclassified":
      return { kind: "continue" };
  }
}
