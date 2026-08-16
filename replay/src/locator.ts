import type { Locator as PwLocator, Page } from "playwright";
import type { Locator, LocatorStrategy } from "@interface-takehome/shared";
import type { ResolvedAction } from "./types";

function toPwLocator(page: Page, strategy: LocatorStrategy): PwLocator {
  switch (strategy.by) {
    case "label":
      return page.getByLabel(strategy.text, { exact: true });
    case "placeholder":
      return page.getByPlaceholder(strategy.text, { exact: true });
    case "role":
      return page.getByRole(strategy.role as any, { name: strategy.name, exact: true });
    case "xpath":
      return page.locator(`xpath=${strategy.value}`);
  }
}

/**
 * Tries a locator's ranked strategy chain in order (rule #1). The first
 * strategy whose action succeeds wins; its tier is what telemetry should
 * watch for drift (an artifact that's stopped resolving on tier 0 has UI
 * that moved out from under it, even though replay is still succeeding via
 * a fallback).
 */
export async function resolveAndAct<T>(
  page: Page,
  locator: Locator,
  act: (pwLocator: PwLocator, strategy: LocatorStrategy) => Promise<T>
): Promise<ResolvedAction<T>> {
  const failures: string[] = [];

  for (let i = 0; i < locator.strategies.length; i++) {
    const strategy = locator.strategies[i];
    try {
      const pwLocator = toPwLocator(page, strategy);
      const value = await act(pwLocator, strategy);
      return { value, tier: strategy.by, tierIndex: i };
    } catch (e) {
      failures.push(`[${i}] ${strategy.by}: ${(e as Error).message}`);
    }
  }

  throw new Error(`no locator strategy resolved:\n${failures.join("\n")}`);
}
