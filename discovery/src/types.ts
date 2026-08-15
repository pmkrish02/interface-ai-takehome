/**
 * Types for the discovery loop: the model's action vocabulary, run
 * configuration, and per-turn evidence records. The Artifact/Step/Locator
 * types themselves come from @interface-takehome/shared — this file only
 * covers discovery-time concerns that never end up in the artifact verbatim.
 */

export type TargetKind = "label" | "role" | "placeholder";

export interface ActionTarget {
  by: TargetKind;
  text?: string; // for label / placeholder
  role?: string; // for role
  name?: string; // for role
}

export type ModelAction =
  | { action: "navigate"; url: string }
  | { action: "click"; target: ActionTarget }
  | { action: "type"; target: ActionTarget; value: string }
  | { action: "extract"; target: ActionTarget; outputName: string }
  | { action: "done"; reason: string };

export interface Credentials {
  username: string;
  password: string;
}

export interface DiscoveryConfig {
  goal: string;
  baseUrl: string;
  app: string;
  tenant: string;
  credentials: Credentials;
  maxSteps: number;
  perStepTimeoutMs: number;
  headless: boolean;
  artifactName?: string;
}

export interface ExecutionResult {
  success: boolean;
  resolvedTier?: TargetKind; // which locator tier the executor used (rule #1)
  error?: string;
  extractedValue?: string; // set for successful "extract" actions
}

export interface TurnRecord {
  turn: number;
  goal: string;
  url: string;
  a11yDigest: string;
  modelAction: unknown; // redacted copy of the raw parsed model action
  execution: ExecutionResult | null; // null if parsing/model call failed
  timestampMs: number;
}
