# Computer-Use Automation System — interface.ai take-home

## What this is
LLM discovers a UI flow once → records a typed artifact → deterministic replay
runs it with NO LLM in the loop. Escalates to human when stuck.

## Stack
TypeScript end-to-end. Playwright for browser automation.
Mock bank app = Express + EJS, server-rendered, intentionally hostile markup.

## Four load-bearing rules
1. LOCATORS: ranked fallback chain per element (label → role → xpath). Log which tier resolved.
2. ERROR TAXONOMY: errors are RECOGNIZED not inferred. Artifact declares known UI outcomes.
   Executor matches screen against them. Legacy apps return HTTP 200 for "record not found" —
   NEVER classify on status code, classify on rendered UI state.
3. LLM OUT OF REPLAY: discovery once, replay is deterministic — auditable, bounded, cheap, data-safe.
4. CROSS-TENANT: base artifact + thin per-tenant override. Growing override size = drift alarm.

## Decisions log
- TypeScript chosen over Go for browser ecosystem (Playwright). Artifact is language-neutral JSON.
- Discovery LLM: gemini-3.1-flash-lite (gemini-3.1-pro returned 404/no-quota on this key)
