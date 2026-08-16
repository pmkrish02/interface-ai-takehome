import type { Page } from "playwright";
import type { Checkpoint } from "@interface-takehome/shared";
import { accessibleNamesContain, capturePageText } from "./pageState";

export async function verifyCheckpoint(page: Page, checkpoint: Checkpoint): Promise<boolean> {
  switch (checkpoint.type) {
    case "textPresent": {
      const text = await capturePageText(page);
      return text.includes(checkpoint.value);
    }
    case "urlMatches":
      return page.url().includes(checkpoint.value);
    case "elementPresent":
      // Matches against the accessibility tree (accessible name/value), not
      // raw DOM text — distinct from textPresent, which checks rendered body
      // text regardless of whether it's exposed to assistive tech.
      return accessibleNamesContain(page, checkpoint.value);
  }
}

export function describeCheckpoint(checkpoint: Checkpoint): string {
  return `${checkpoint.type}="${checkpoint.value}"`;
}
