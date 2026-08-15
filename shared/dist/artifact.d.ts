/**
 * Artifact schema — the typed, language-neutral output of discovery and the
 * sole input to replay. See CLAUDE.md: LLM discovers a flow once, replay is
 * deterministic against this shape (rule #3, LLM OUT OF REPLAY).
 */
export type LocatorStrategy = {
    by: "label";
    text: string;
} | {
    by: "role";
    role: string;
    name: string;
} | {
    by: "placeholder";
    text: string;
} | {
    by: "xpath";
    value: string;
};
export interface Locator {
    strategies: LocatorStrategy[];
}
export type CheckpointType = "textPresent" | "elementPresent" | "urlMatches";
export interface Checkpoint {
    type: CheckpointType;
    value: string;
}
export type StepAction = "navigate" | "click" | "type" | "extract";
export interface Step {
    action: StepAction;
    locator?: Locator;
    url?: string;
    param?: string;
    output?: string;
    checkpoint?: Checkpoint;
}
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
export type KnownOutcomeKind = "business_outcome" | "recoverable" | "hard_failure";
export type RecoverableAction = "relogin" | "retry" | "dismiss";
export interface KnownOutcome {
    name: string;
    match: string;
    kind: KnownOutcomeKind;
    action?: RecoverableAction;
}
export interface Target {
    app: string;
    baseUrl: string;
    tenant: string;
}
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
export type ReplayResult = {
    status: "success";
    outputs: Record<string, string>;
} | {
    status: "business_outcome";
    outcome: string;
} | {
    status: "hard_failure";
    step: number;
    expected: string;
    observed: string;
};
export declare function isArtifact(x: unknown): x is Artifact;
