import * as fs from "fs";
import * as path from "path";
import type { Page } from "playwright";

export function evidenceDirs(evidenceRoot: string): { escalations: string } {
  const escalations = path.join(evidenceRoot, "escalations");
  fs.mkdirSync(escalations, { recursive: true });
  return { escalations };
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function saveScreenshot(page: Page, dir: string, label: string): Promise<string> {
  const file = path.join(dir, `${label}-${timestampSlug()}.png`);
  try {
    await page.screenshot({ path: file });
  } catch {
    // best-effort — a screenshot failure shouldn't mask the underlying issue
  }
  return file;
}

export interface EscalationRecord {
  timestamp: string;
  artifact: string;
  stepIndex: number;
  reason: string;
  expected: string | null;
  observed: string | null;
  url: string;
  screenshotPath: string;
  postHandoff?: {
    url: string;
    a11ySnapshot: unknown;
  };
}

export function writeEscalationFile(dir: string, record: EscalationRecord): string {
  const file = path.join(dir, `${timestampSlug()}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return file;
}

export function appendPostHandoff(file: string, postHandoff: EscalationRecord["postHandoff"]): void {
  const record: EscalationRecord = JSON.parse(fs.readFileSync(file, "utf-8"));
  record.postHandoff = postHandoff;
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
}
