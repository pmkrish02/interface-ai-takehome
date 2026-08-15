import type { Credentials } from "./types";

/**
 * Names a "type" value that came from the goal, so it can be recorded as a
 * parameter reference instead of a literal (per the discovery brief). This
 * is a heuristic, not a parser: it looks for "<noun> <value>" phrasing near
 * the value in the goal text and falls back to a generic name.
 */
const NOUN_HINTS: Array<{ regex: RegExp; name: string }> = [
  { regex: /member\s*(?:id)?\s*[:#]?\s*["']?([A-Za-z0-9-]+)["']?/i, name: "memberId" },
  { regex: /account\s*(?:id)?\s*[:#]?\s*["']?([A-Za-z0-9-]+)["']?/i, name: "accountId" },
];

export interface ParamInferrer {
  /** Returns the parameter name a literal value should be recorded under. */
  nameFor(value: string): string;
}

export function createParamInferrer(goal: string, credentials: Credentials): ParamInferrer {
  const fallbackCounter = { n: 0 };
  const assigned = new Map<string, string>(); // value -> paramName, stable across repeats

  return {
    nameFor(value: string): string {
      const normalized = value.trim().toLowerCase();
      if (normalized === credentials.username.toLowerCase()) return "username";
      if (normalized === credentials.password) return "password";

      const cached = assigned.get(normalized);
      if (cached) return cached;

      for (const { regex, name } of NOUN_HINTS) {
        const match = goal.match(regex);
        if (match && match[1].trim().toLowerCase() === normalized) {
          assigned.set(normalized, name);
          return name;
        }
      }

      fallbackCounter.n += 1;
      const name = `param${fallbackCounter.n}`;
      assigned.set(normalized, name);
      return name;
    },
  };
}
