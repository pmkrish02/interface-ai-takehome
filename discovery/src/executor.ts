import type { Locator as PwLocator, Page } from "playwright";
import type { Locator, LocatorStrategy } from "@interface-takehome/shared";
import type { ActionTarget, ExecutionResult, ModelAction, TargetKind } from "./types";

/**
 * Resolves an ActionTarget to a live Playwright locator using exactly the
 * tier the model chose (rule #1 asks the executor to log which tier
 * resolved — during discovery that tier is simply the model's pick, since
 * discovery only needs one working path per step; the ranked fallback chain
 * recorded into the artifact for REPLAY is built separately, see
 * buildLocatorChain below, so replay can fall back across tiers later).
 */
function resolvePwLocator(page: Page, target: ActionTarget): PwLocator {
  switch (target.by) {
    case "label":
      return page.getByLabel(target.text!, { exact: true });
    case "placeholder":
      return page.getByPlaceholder(target.text!, { exact: true });
    case "role":
      return page.getByRole(target.role as any, { name: target.name, exact: true });
  }
}

async function readElementValue(pwLocator: PwLocator): Promise<string> {
  const tag = await pwLocator.evaluate((el) => el.tagName.toLowerCase(), { timeout: 5000 });
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return await pwLocator.inputValue({ timeout: 5000 });
  }
  return ((await pwLocator.textContent({ timeout: 5000 })) ?? "").trim();
}

/**
 * Resolves the element an "extract" action should read. Form fields (where
 * a <label> is properly associated via `for`) use that association. But
 * this app's read-only display values (e.g. the member's savings balance)
 * are rendered as a bare <label> next to a value cell with no `for`
 * attribute at all — getByLabel finds nothing there. The fallback locates
 * the <label> by its exact text and reads the rest of its table row, which
 * is how every display field in this app's hostile markup is laid out.
 */
async function resolveExtractTarget(
  page: Page,
  target: ActionTarget
): Promise<{ value: string; pwLocator: PwLocator }> {
  if (target.by === "label") {
    const formLocator = page.getByLabel(target.text!, { exact: true });
    if ((await formLocator.count()) > 0) {
      return { value: await readElementValue(formLocator), pwLocator: formLocator };
    }

    const labelLocator = page
      .locator(`xpath=//label[normalize-space(text())="${target.text}"]`)
      .first();
    const rowLocator = labelLocator.locator("xpath=ancestor::tr[1]");
    const rowText = ((await rowLocator.textContent({ timeout: 5000 })) ?? "").trim();
    const value = rowText.startsWith(target.text!)
      ? rowText.slice(target.text!.length).trim()
      : rowText;
    return { value, pwLocator: labelLocator };
  }

  const pwLocator = resolvePwLocator(page, target);
  return { value: await readElementValue(pwLocator), pwLocator };
}

async function computeXPath(pwLocator: PwLocator): Promise<string | null> {
  try {
    return await pwLocator.evaluate((el: Element) => {
      function xpathFor(node: Element): string {
        if (node.id) return `//*[@id="${node.id}"]`;
        const parts: string[] = [];
        let cur: Element | null = node;
        while (cur && cur.nodeType === 1) {
          let index = 1;
          let sibling = cur.previousElementSibling;
          while (sibling) {
            if (sibling.nodeName === cur.nodeName) index++;
            sibling = sibling.previousElementSibling;
          }
          parts.unshift(`${cur.nodeName.toLowerCase()}[${index}]`);
          cur = cur.parentElement;
        }
        return "/" + parts.join("/");
      }
      return xpathFor(el);
    });
  } catch {
    return null;
  }
}

const IMPLICIT_ROLE_BY_TAG: Record<string, string> = {
  a: "link",
  button: "button",
};

async function computeRoleStrategy(pwLocator: PwLocator): Promise<LocatorStrategy | null> {
  try {
    const info = await pwLocator.evaluate((el: Element) => {
      const tag = el.tagName.toLowerCase();
      const type = (el as HTMLInputElement).type;
      const ariaLabel = el.getAttribute("aria-label");
      const text = (el.textContent || "").trim();
      const placeholder = el.getAttribute("placeholder");
      return { tag, type, ariaLabel, text, placeholder };
    });
    let role: string | null = IMPLICIT_ROLE_BY_TAG[info.tag] ?? null;
    if (info.tag === "input") {
      if (info.type === "submit" || info.type === "button") role = "button";
      else if (info.type === "password") role = "textbox";
      else if (info.type === "checkbox") role = "checkbox";
      else role = "textbox";
    }
    if (!role) return null;
    const name = info.ariaLabel || info.text || info.placeholder;
    if (!name) return null;
    return { by: "role", role, name };
  } catch {
    return null;
  }
}

/**
 * Builds the ranked locator strategy chain recorded into the Artifact for
 * this step: the tier the model actually used first, an independently
 * derived role-based strategy second (when derivable and different from the
 * primary), and an absolute xpath last as the rule #1 last-resort fallback.
 */
export async function buildLocatorChain(
  page: Page,
  target: ActionTarget,
  pwLocator: PwLocator
): Promise<Locator> {
  const primary: LocatorStrategy =
    target.by === "role"
      ? { by: "role", role: target.role!, name: target.name! }
      : target.by === "label"
        ? { by: "label", text: target.text! }
        : { by: "placeholder", text: target.text! };

  const strategies: LocatorStrategy[] = [primary];

  if (target.by !== "role") {
    const roleStrategy = await computeRoleStrategy(pwLocator);
    if (roleStrategy) strategies.push(roleStrategy);
  }

  const xpath = await computeXPath(pwLocator);
  if (xpath) strategies.push({ by: "xpath", value: xpath });

  return { strategies };
}

export interface ExecuteOutcome {
  result: ExecutionResult;
  locatorChain?: Locator; // present for click/type/extract on success
}

export async function executeAction(page: Page, action: ModelAction): Promise<ExecuteOutcome> {
  try {
    switch (action.action) {
      case "navigate": {
        await page.goto(action.url, { waitUntil: "load" });
        return { result: { success: true } };
      }
      case "click": {
        const pwLocator = resolvePwLocator(page, action.target);
        // Built before clicking: a click can navigate away and detach the
        // element, which would break xpath/role derivation afterward.
        const locatorChain = await buildLocatorChain(page, action.target, pwLocator);
        await pwLocator.click({ timeout: 5000 });
        return {
          result: { success: true, resolvedTier: action.target.by as TargetKind },
          locatorChain,
        };
      }
      case "type": {
        const pwLocator = resolvePwLocator(page, action.target);
        await pwLocator.fill(action.value, { timeout: 5000 });
        const locatorChain = await buildLocatorChain(page, action.target, pwLocator);
        return {
          result: { success: true, resolvedTier: action.target.by as TargetKind },
          locatorChain,
        };
      }
      case "extract": {
        const { value, pwLocator } = await resolveExtractTarget(page, action.target);
        const locatorChain = await buildLocatorChain(page, action.target, pwLocator);
        return {
          result: { success: true, resolvedTier: action.target.by as TargetKind, extractedValue: value },
          locatorChain,
        };
      }
      case "done":
        return { result: { success: true } };
    }
  } catch (e) {
    return { result: { success: false, error: (e as Error).message } };
  }
}
