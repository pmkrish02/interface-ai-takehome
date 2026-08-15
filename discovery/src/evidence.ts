import * as fs from "fs";
import * as path from "path";
import type { Page } from "playwright";
import type { Credentials, TurnRecord } from "./types";

/**
 * Structured per-turn log (JSONL) plus failure screenshots. Redaction rule
 * (discovery brief): never write the API key or full page HTML — only a
 * bounded a11y digest ends up in the log, and any "type" value equal to the
 * configured password is masked before it's written.
 */
export class EvidenceWriter {
  private readonly logPath: string;
  private readonly dir: string;

  constructor(evidenceRoot: string, private readonly credentials: Credentials) {
    this.dir = path.join(evidenceRoot, "discovery");
    fs.mkdirSync(this.dir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logPath = path.join(this.dir, `${timestamp}.jsonl`);
  }

  private redact(action: unknown): unknown {
    if (
      typeof action === "object" &&
      action !== null &&
      "action" in action &&
      (action as any).action === "type" &&
      (action as any).value === this.credentials.password
    ) {
      return { ...(action as object), value: "[REDACTED]" };
    }
    return action;
  }

  appendTurn(turn: TurnRecord): void {
    const redacted: TurnRecord = { ...turn, modelAction: this.redact(turn.modelAction) };
    fs.appendFileSync(this.logPath, JSON.stringify(redacted) + "\n");
  }

  async saveFailureScreenshot(page: Page, turn: number): Promise<void> {
    const file = path.join(this.dir, `failure-step${turn}-${Date.now()}.png`);
    try {
      await page.screenshot({ path: file });
    } catch {
      // best-effort; a screenshot failure shouldn't mask the underlying error
    }
  }
}
