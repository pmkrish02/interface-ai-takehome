import type { Page } from "playwright";
import type { Artifact, RecoverableAction } from "@interface-takehome/shared";
import { executeStep } from "./executor";

const DISMISS_LABELS = ["OK", "Dismiss", "Close", "Continue"];

/**
 * Best-effort automatic recovery for a "recoverable" known outcome. Returns
 * whether recovery appears to have done something usable; the caller is
 * responsible for re-checking page state and re-attempting the step.
 *
 * "relogin" replays the artifact's OWN username/password/login steps rather
 * than guessing a login flow — those locators are already proven to work by
 * discovery, which keeps recovery just as deterministic as the rest of
 * replay (rule #3).
 */
export async function attemptRecovery(
  page: Page,
  action: RecoverableAction,
  artifact: Artifact,
  params: Record<string, string>
): Promise<boolean> {
  switch (action) {
    case "retry":
      // No state-changing action — the caller simply re-attempts the step.
      return true;

    case "relogin": {
      const usernameStep = artifact.steps.find((s) => s.action === "type" && s.param === "username");
      const passwordStep = artifact.steps.find((s) => s.action === "type" && s.param === "password");
      const loginClickStep = artifact.steps.find((s) => s.action === "click");
      if (!usernameStep || !passwordStep || !loginClickStep) return false;

      await page.goto(artifact.target.baseUrl, { waitUntil: "load" });
      const u = await executeStep(page, usernameStep, params);
      const p = await executeStep(page, passwordStep, params);
      const c = await executeStep(page, loginClickStep, params);
      return u.success && p.success && c.success;
    }

    case "dismiss": {
      for (const label of DISMISS_LABELS) {
        const button = page.getByRole("button", { name: label, exact: true });
        if ((await button.count()) > 0) {
          await button.click({ timeout: 5000 }).catch(() => {});
          return true;
        }
      }
      return false;
    }
  }
}
