import type { KnownOutcome, LocatorStrategy } from "@interface-takehome/shared";

/**
 * Outcome of resolving+acting on a step's locator chain. `tier` records
 * which ranked strategy actually worked (rule #1 telemetry for drift
 * detection): if an artifact keeps resolving on its xpath fallback instead
 * of its label/role tier, that's a signal the primary locators have drifted.
 */
export interface ResolvedAction<T> {
  value: T;
  tier: LocatorStrategy["by"];
  tierIndex: number;
}

export interface StepExecutionResult {
  success: boolean;
  tier?: LocatorStrategy["by"];
  extractedValue?: string;
  error?: string;
}

/** Result of matching the current page against the artifact's outcome catalog. */
export type PageClassification =
  | { kind: "success" }
  | { kind: "business_outcome"; outcome: KnownOutcome }
  | { kind: "recoverable"; outcome: KnownOutcome }
  | { kind: "hard_failure_outcome"; outcome: KnownOutcome }
  | { kind: "unclassified" };

/** What the operator's Enter keypress resolved an escalation to. */
export type EscalationResolution =
  | { kind: "success" }
  | { kind: "business_outcome"; outcome: KnownOutcome }
  | { kind: "recoverable"; outcome: KnownOutcome }
  | { kind: "hard_failure"; outcome: KnownOutcome }
  /** Operator fixed things by hand; nothing in the catalog matches — move on. */
  | { kind: "continue" };
