import type { Page } from "playwright";
import type { Step } from "@interface-takehome/shared";
import { resolveAndAct } from "./locator";
import type { StepExecutionResult } from "./types";

async function readElementValue(pwLocator: import("playwright").Locator): Promise<string> {
  const tag = await pwLocator.evaluate((el) => el.tagName.toLowerCase(), { timeout: 5000 });
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return await pwLocator.inputValue({ timeout: 5000 });
  }
  return ((await pwLocator.textContent({ timeout: 5000 })) ?? "").trim();
}

/**
 * Executes one recorded step. Locator resolution always walks the ranked
 * strategy chain (rule #1) via resolveAndAct, which reports which tier
 * ultimately worked.
 */
export async function executeStep(
  page: Page,
  step: Step,
  params: Record<string, string>
): Promise<StepExecutionResult> {
  try {
    switch (step.action) {
      case "navigate": {
        if (!step.url) throw new Error("navigate step missing url");
        await page.goto(step.url, { waitUntil: "load" });
        return { success: true };
      }

      case "click": {
        if (!step.locator) throw new Error("click step missing locator");
        const resolved = await resolveAndAct(page, step.locator, (pwLocator) =>
          pwLocator.click({ timeout: 5000 })
        );
        return { success: true, tier: resolved.tier };
      }

      case "type": {
        if (!step.locator) throw new Error("type step missing locator");
        if (!step.param) throw new Error("type step missing param reference");
        const value = params[step.param];
        if (value === undefined) throw new Error(`missing param value for "${step.param}"`);
        const resolved = await resolveAndAct(page, step.locator, (pwLocator) =>
          pwLocator.fill(value, { timeout: 5000 })
        );
        return { success: true, tier: resolved.tier };
      }

      case "extract": {
        if (!step.locator) throw new Error("extract step missing locator");
        const resolved = await resolveAndAct(page, step.locator, async (pwLocator, strategy) => {
          if (strategy.by === "label") {
            if ((await pwLocator.count()) > 0) return readElementValue(pwLocator);
            // Hostile markup: a bare <label> with no `for`, value in the
            // same table row. See discovery/src/executor.ts for the twin
            // of this convention — replay must not depend on discovery,
            // so it's duplicated rather than imported.
            const labelLocator = page
              .locator(`xpath=//label[normalize-space(text())="${strategy.text}"]`)
              .first();
            const rowLocator = labelLocator.locator("xpath=ancestor::tr[1]");
            const rowText = ((await rowLocator.textContent({ timeout: 5000 })) ?? "").trim();
            return rowText.startsWith(strategy.text) ? rowText.slice(strategy.text.length).trim() : rowText;
          }
          return readElementValue(pwLocator);
        });
        return { success: true, tier: resolved.tier, extractedValue: resolved.value };
      }
    }
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
