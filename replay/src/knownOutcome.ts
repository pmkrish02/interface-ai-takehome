import type { Artifact, KnownOutcome } from "@interface-takehome/shared";
import type { Page } from "playwright";
import { capturePageText } from "./pageState";
import { verifyCheckpoint } from "./checkpoint";
import type { PageClassification } from "./types";

/**
 * Classifies the current page against the artifact's declared outcomes
 * (CLAUDE.md rule #2 — errors are RECOGNIZED, never inferred, and never
 * classified on HTTP status).
 *
 * `allowSuccess` guards the successCheckpoint check: the checkpoint text can
 * already be on the page before every step has run (e.g. a member's balance
 * renders on the same page the "extract" step still needs to read) — a
 * premature success match there would return before outputs are collected.
 * The engine passes allowSuccess:false for routine per-step checks (only
 * known outcomes can short-circuit those, per rule #2) and true only once
 * all steps have executed, or when a human may have finished the run by
 * hand during an escalation.
 */
export async function classifyPage(
  page: Page,
  artifact: Artifact,
  allowSuccess = true
): Promise<PageClassification> {
  if (allowSuccess && (await verifyCheckpoint(page, artifact.successCheckpoint))) {
    return { kind: "success" };
  }

  const text = await capturePageText(page);
  const outcome = matchKnownOutcome(text, artifact.knownOutcomes);
  if (!outcome) return { kind: "unclassified" };

  switch (outcome.kind) {
    case "business_outcome":
      return { kind: "business_outcome", outcome };
    case "recoverable":
      return { kind: "recoverable", outcome };
    case "hard_failure":
      return { kind: "hard_failure_outcome", outcome };
  }
}

export function matchKnownOutcome(pageText: string, knownOutcomes: KnownOutcome[]): KnownOutcome | null {
  return knownOutcomes.find((o) => pageText.includes(o.match)) ?? null;
}
