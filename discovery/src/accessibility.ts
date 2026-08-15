import type { Page } from "playwright";
import * as crypto from "crypto";

/**
 * A pruned view of Playwright's accessibility tree: drops nodes that carry
 * no information (generic/none roles with no name and no children) so the
 * hostile table-and-div markup collapses down to the labels, inputs, links,
 * and text an operator would actually act on.
 */
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

  // Collapse a noise wrapper that has exactly one child into that child.
  if (NOISE_ROLES.has(node.role) && !node.name && !node.value && children.length === 1) {
    return children[0];
  }

  const simplified: SimplifiedNode = { role: node.role };
  if (node.name) simplified.name = node.name;
  if (node.value !== undefined && node.value !== "") simplified.value = String(node.value);
  if (children.length > 0) simplified.children = children;
  return simplified;
}

export async function captureA11yTree(page: Page): Promise<SimplifiedNode | null> {
  const snapshot = await page.accessibility.snapshot({ interestingOnly: true });
  return simplify(snapshot);
}

/**
 * A digest for the evidence log: full JSON up to a size cap, plus a hash of
 * the untruncated tree so evidence entries can still be deduped/compared
 * without the log ballooning on large pages.
 */
export function digestA11yTree(tree: SimplifiedNode | null, maxChars = 4000): string {
  const json = JSON.stringify(tree ?? {});
  const hash = crypto.createHash("sha256").update(json).digest("hex").slice(0, 12);
  const body = json.length > maxChars ? `${json.slice(0, maxChars)}...<truncated>` : json;
  return `sha256:${hash} ${body}`;
}
