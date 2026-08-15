import type {
  Artifact,
  Checkpoint,
  Output,
  Parameter,
  Step,
} from "@interface-takehome/shared";
import { isArtifact } from "@interface-takehome/shared";
import { MOCK_BANK_KNOWN_OUTCOMES } from "./knownOutcomes";
import type { DiscoveryConfig } from "./types";

function slugify(goal: string): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "discovered-flow";
}

/**
 * Builds up the Artifact as the discovery loop records successful steps.
 * No LLM involvement here — this is pure bookkeeping so the finished
 * Artifact is exactly what a deterministic replayer needs (rule #3).
 */
export class ArtifactRecorder {
  private readonly steps: Step[] = [];
  private readonly parameters = new Map<string, Parameter>();
  private readonly outputs = new Map<string, Output>();
  private lastExtracted: { name: string; value: string } | null = null;

  constructor(private readonly config: DiscoveryConfig) {}

  recordNavigate(url: string): void {
    this.steps.push({ action: "navigate", url });
  }

  recordType(paramName: string, locator: Step["locator"]): void {
    if (!this.parameters.has(paramName)) {
      this.parameters.set(paramName, { name: paramName, type: "string", required: true });
    }
    this.steps.push({ action: "type", locator, param: paramName });
  }

  recordClick(locator: Step["locator"]): void {
    this.steps.push({ action: "click", locator });
  }

  recordExtract(outputName: string, locator: Step["locator"], value: string): void {
    this.outputs.set(outputName, { name: outputName, type: "string" });
    this.steps.push({ action: "extract", locator, output: outputName });
    this.lastExtracted = { name: outputName, value };
  }

  finalize(finalUrl: string): Artifact {
    const successCheckpoint: Checkpoint = this.lastExtracted
      ? { type: "textPresent", value: this.lastExtracted.value }
      : { type: "urlMatches", value: new URL(finalUrl).pathname };

    const artifact: Artifact = {
      name: this.config.artifactName ?? slugify(this.config.goal),
      description: this.config.goal,
      version: "1.0.0",
      target: {
        app: this.config.app,
        baseUrl: this.config.baseUrl,
        tenant: this.config.tenant,
      },
      parameters: Array.from(this.parameters.values()),
      outputs: Array.from(this.outputs.values()),
      steps: this.steps,
      knownOutcomes: MOCK_BANK_KNOWN_OUTCOMES,
      successCheckpoint,
    };

    if (!isArtifact(artifact)) {
      throw new Error("recorded artifact failed schema validation — this is a recorder bug");
    }
    return artifact;
  }
}
