import type { Artifact } from "@interface-takehome/shared";

/** Validates the caller's params against artifact.parameters and coerces to strings for use as form values. */
export function normalizeParams(
  artifact: Artifact,
  rawParams: Record<string, unknown>
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const param of artifact.parameters) {
    const value = rawParams[param.name];
    if (value === undefined || value === null) {
      if (param.required) {
        throw new Error(`missing required parameter "${param.name}"`);
      }
      continue;
    }
    normalized[param.name] = String(value);
  }

  return normalized;
}
