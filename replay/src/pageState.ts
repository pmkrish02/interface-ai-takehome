import type { Page } from "playwright";

/**
 * Rendered body text of the current page — the only thing outcome
 * classification is allowed to look at (CLAUDE.md rule #2: classify on
 * rendered UI state, never HTTP status).
 */
export async function capturePageText(page: Page): Promise<string> {
  try {
    return (await page.locator("body").innerText({ timeout: 5000 })) ?? "";
  } catch {
    return "";
  }
}

export interface SimplifiedNode {
  role: string;
  name?: string;
  value?: string;
  children?: SimplifiedNode[];
}

const NOISE_ROLES = new Set(["generic", "none", "InlineTextBox"]);

function simplify(node: any): SimplifiedNode | null {
  if (!node) return null;
  const children = (node.children ?? [])
    .map(simplify)
    .filter((c: SimplifiedNode | null): c is SimplifiedNode => c !== null);

  const isNoise =
    NOISE_ROLES.has(node.role) && !node.name && !node.value && children.length === 0;
  if (isNoise) return null;
  if (NOISE_ROLES.has(node.role) && !node.name && !node.value && children.length === 1) {
    return children[0];
  }

  const simplified: SimplifiedNode = { role: node.role };
  if (node.name) simplified.name = node.name;
  if (node.value !== undefined && node.value !== "") simplified.value = String(node.value);
  if (children.length > 0) simplified.children = children;
  return simplified;
}

/** Used only for escalation evidence and the "elementPresent" checkpoint — never fed to an LLM. */
export async function captureA11yTree(page: Page): Promise<SimplifiedNode | null> {
  try {
    const snapshot = await page.accessibility.snapshot({ interestingOnly: true });
    return simplify(snapshot);
  } catch {
    return null;
  }
}

function flattenNames(node: SimplifiedNode | null, out: string[]): void {
  if (!node) return;
  if (node.name) out.push(node.name);
  if (node.value) out.push(node.value);
  for (const child of node.children ?? []) flattenNames(child, out);
}

export async function accessibleNamesContain(page: Page, text: string): Promise<boolean> {
  const tree = await captureA11yTree(page);
  const names: string[] = [];
  flattenNames(tree, names);
  return names.some((n) => n === text || n.includes(text));
}
