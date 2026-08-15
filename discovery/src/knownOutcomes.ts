import type { KnownOutcome } from "@interface-takehome/shared";

/**
 * The mock-bank app's UI outcome catalog (see mock-bank/README.md). Rule #2
 * (CLAUDE.md): errors are RECOGNIZED, not inferred — this list is domain
 * knowledge baked in ahead of time, not something guessed from a single
 * discovery trace. Every artifact recorded against this app carries the
 * full catalog so the replay executor can match rendered UI state against
 * it regardless of which outcomes this particular run happened to hit.
 *
 * All of these render at HTTP 200 except the "server" trigger, which the
 * app deliberately returns as a real 500 — replay must never classify on
 * status code (rule #2).
 */
export const MOCK_BANK_KNOWN_OUTCOMES: KnownOutcome[] = [
  {
    name: "MEMBER_NOT_FOUND",
    match: "Record not found",
    kind: "business_outcome",
  },
  {
    name: "SESSION_EXPIRED",
    match: "Session expired, please login again",
    kind: "recoverable",
    action: "relogin",
  },
  {
    name: "PERMISSION_DENIED",
    match: "You are not authorized",
    kind: "business_outcome",
  },
  {
    name: "INVALID_CREDENTIALS",
    match: "Invalid username or password",
    kind: "recoverable",
    action: "retry",
  },
];
