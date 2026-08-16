/**
 * Artifact schema — the typed, language-neutral output of discovery and the
 * sole input to replay. See CLAUDE.md: LLM discovers a flow once, replay is
 * deterministic against this shape (rule #3, LLM OUT OF REPLAY).
 */

// ---------------------------------------------------------------------------
// Locators — ranked fallback chain per element (rule #1). Executors must log
// which tier resolved.
// ---------------------------------------------------------------------------

export type LocatorStrategy =
  | { by: "label"; text: string }
  | { by: "role"; role: string; name: string }
  | { by: "placeholder"; text: string }
  | { by: "xpath"; value: string }; // last-resort fallback

export interface Locator {
  strategies: LocatorStrategy[]; // ranked, tried in order
}

// ---------------------------------------------------------------------------
// Checkpoints — post-conditions that prove a step (or the whole run) worked.
// ---------------------------------------------------------------------------

export type CheckpointType = "textPresent" | "elementPresent" | "urlMatches";

export interface Checkpoint {
  type: CheckpointType;
  value: string;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type StepAction = "navigate" | "click" | "type" | "extract";

export interface Step {
  action: StepAction;
  locator?: Locator; // omitted for navigate
  url?: string; // for navigate
  param?: string; // for type — references a parameter name
  output?: string; // for extract — names the result
  checkpoint?: Checkpoint; // post-condition proving the step worked
  risky?: boolean; // replay must pause for human confirmation before this step
}

// ---------------------------------------------------------------------------
// Parameters / outputs
// ---------------------------------------------------------------------------

export type PrimitiveType = "string" | "number";

export interface Parameter {
  name: string;
  type: PrimitiveType;
  required: boolean;
}

export interface Output {
  name: string;
  type: PrimitiveType;
}

// ---------------------------------------------------------------------------
// Known outcomes — errors are RECOGNIZED, not inferred (rule #2). The
// artifact declares every known UI outcome; the executor matches the
// rendered screen against them rather than trusting HTTP status codes.
// ---------------------------------------------------------------------------

export type KnownOutcomeKind =
  | "business_outcome"
  | "recoverable"
  | "hard_failure";

export type RecoverableAction = "relogin" | "retry" | "dismiss";

export interface KnownOutcome {
  name: string; // e.g. "MEMBER_NOT_FOUND"
  match: string; // text to recognize on the rendered page
  kind: KnownOutcomeKind;
  action?: RecoverableAction; // for recoverable
}

// ---------------------------------------------------------------------------
// Target — cross-tenant base + override (rule #4).
// ---------------------------------------------------------------------------

export interface Target {
  app: string;
  baseUrl: string;
  tenant: string;
}

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

export interface Artifact {
  name: string;
  description: string;
  version: string;
  target: Target;
  parameters: Parameter[];
  outputs: Output[];
  steps: Step[];
  knownOutcomes: KnownOutcome[];
  successCheckpoint: Checkpoint;
}

// ---------------------------------------------------------------------------
// Replay result — what the executor returns to a caller. No LLM in this
// path (rule #3): every branch here is a deterministic, auditable outcome.
// ---------------------------------------------------------------------------

export type ReplayResult =
  | { status: "success"; outputs: Record<string, string> }
  | { status: "business_outcome"; outcome: string } // e.g. MEMBER_NOT_FOUND
  | { status: "hard_failure"; step: number; expected: string; observed: string };

// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------

function isString(x: unknown): x is string {
  return typeof x === "string";
}

function isBoolean(x: unknown): x is boolean {
  return typeof x === "boolean";
}

function isPrimitiveType(x: unknown): x is PrimitiveType {
  return x === "string" || x === "number";
}

function isLocatorStrategy(x: unknown): x is LocatorStrategy {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  switch (s.by) {
    case "label":
      return isString(s.text);
    case "role":
      return isString(s.role) && isString(s.name);
    case "placeholder":
      return isString(s.text);
    case "xpath":
      return isString(s.value);
    default:
      return false;
  }
}

function isLocator(x: unknown): x is Locator {
  if (typeof x !== "object" || x === null) return false;
  const l = x as Record<string, unknown>;
  return Array.isArray(l.strategies) && l.strategies.every(isLocatorStrategy);
}

function isCheckpoint(x: unknown): x is Checkpoint {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Record<string, unknown>;
  return (
    (c.type === "textPresent" ||
      c.type === "elementPresent" ||
      c.type === "urlMatches") &&
    isString(c.value)
  );
}

function isStep(x: unknown): x is Step {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  if (
    s.action !== "navigate" &&
    s.action !== "click" &&
    s.action !== "type" &&
    s.action !== "extract"
  ) {
    return false;
  }
  if (s.locator !== undefined && !isLocator(s.locator)) return false;
  if (s.url !== undefined && !isString(s.url)) return false;
  if (s.param !== undefined && !isString(s.param)) return false;
  if (s.output !== undefined && !isString(s.output)) return false;
  if (s.checkpoint !== undefined && !isCheckpoint(s.checkpoint)) return false;
  if (s.risky !== undefined && !isBoolean(s.risky)) return false;
  return true;
}

function isParameter(x: unknown): x is Parameter {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;
  return isString(p.name) && isPrimitiveType(p.type) && isBoolean(p.required);
}

function isOutput(x: unknown): x is Output {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return isString(o.name) && isPrimitiveType(o.type);
}

function isKnownOutcome(x: unknown): x is KnownOutcome {
  if (typeof x !== "object" || x === null) return false;
  const k = x as Record<string, unknown>;
  if (!isString(k.name) || !isString(k.match)) return false;
  if (
    k.kind !== "business_outcome" &&
    k.kind !== "recoverable" &&
    k.kind !== "hard_failure"
  ) {
    return false;
  }
  if (
    k.action !== undefined &&
    k.action !== "relogin" &&
    k.action !== "retry" &&
    k.action !== "dismiss"
  ) {
    return false;
  }
  return true;
}

function isTarget(x: unknown): x is Target {
  if (typeof x !== "object" || x === null) return false;
  const t = x as Record<string, unknown>;
  return isString(t.app) && isString(t.baseUrl) && isString(t.tenant);
}

export function isArtifact(x: unknown): x is Artifact {
  if (typeof x !== "object" || x === null) return false;
  const a = x as Record<string, unknown>;
  return (
    isString(a.name) &&
    isString(a.description) &&
    isString(a.version) &&
    isTarget(a.target) &&
    Array.isArray(a.parameters) &&
    a.parameters.every(isParameter) &&
    Array.isArray(a.outputs) &&
    a.outputs.every(isOutput) &&
    Array.isArray(a.steps) &&
    a.steps.every(isStep) &&
    Array.isArray(a.knownOutcomes) &&
    a.knownOutcomes.every(isKnownOutcome) &&
    isCheckpoint(a.successCheckpoint)
  );
}
