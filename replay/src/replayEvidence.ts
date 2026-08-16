import * as fs from "fs";
import * as path from "path";
import type { Artifact, LocatorStrategy, ReplayResult, StepAction } from "@interface-takehome/shared";
import type { PageClassification } from "./types";

/**
 * Same redaction stance as discovery/src/evidence.ts: never write a literal
 * secret value into evidence. Discovery redacts by comparing against the
 * one known credential; replay has no fixed credential set (params are
 * caller-supplied and artifact-defined), so it redacts by NAME pattern
 * instead — "password especially", per the brief.
 */
const SENSITIVE_NAME_PATTERN = /password|secret|token|api[_-]?key|credential/i;

export function redactParams(params: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) {
    redacted[name] = SENSITIVE_NAME_PATTERN.test(name) ? "[REDACTED]" : value;
  }
  return redacted;
}

export function describeClassification(classification: PageClassification): string {
  switch (classification.kind) {
    case "success":
      return "success";
    case "business_outcome":
      return `business_outcome:${classification.outcome.name}`;
    case "recoverable":
      return `recoverable:${classification.outcome.name}`;
    case "hard_failure_outcome":
      return `hard_failure_outcome:${classification.outcome.name}`;
    case "unclassified":
      return "unclassified";
  }
}

export interface ReplayStepRecord {
  stepIndex: number;
  action: StepAction;
  note?: string; // e.g. "risky-preflight", "recoverable-retry", "final-check"
  paramRef?: string; // the param NAME a "type" step read from — never its literal value
  outputRef?: string; // the output NAME an "extract" step wrote to
  tier?: LocatorStrategy["by"]; // which ranked locator tier resolved (rule #1 telemetry)
  execSuccess?: boolean;
  execError?: string;
  classification?: string;
  timestampMs: number;
}

/**
 * Mirrors discovery/src/evidence.ts's EvidenceWriter: one JSONL log per run
 * (step-by-step telemetry) plus, here, a paired compact summary JSON.
 */
export class ReplayEvidenceWriter {
  private readonly dir: string;
  private readonly logPath: string;
  readonly summaryPath: string;
  private readonly startedAt: number;

  constructor(evidenceRoot: string, private readonly artifact: Artifact) {
    this.dir = path.join(evidenceRoot, "replays");
    fs.mkdirSync(this.dir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logPath = path.join(this.dir, `${timestamp}.jsonl`);
    this.summaryPath = path.join(this.dir, `${timestamp}.summary.json`);
    this.startedAt = Date.now();
  }

  logStep(record: Omit<ReplayStepRecord, "timestampMs">): void {
    const line: ReplayStepRecord = { ...record, timestampMs: Date.now() };
    fs.appendFileSync(this.logPath, JSON.stringify(line) + "\n");
  }

  writeSummary(paramsUsed: Record<string, string>, result: ReplayResult): void {
    const summary = {
      timestamp: new Date().toISOString(),
      artifact: this.artifact.name,
      target: this.artifact.target,
      paramsUsed: redactParams(paramsUsed),
      status: result.status,
      result,
      durationMs: Date.now() - this.startedAt,
      log: this.logPath,
    };
    fs.writeFileSync(this.summaryPath, JSON.stringify(summary, null, 2));
  }
}
