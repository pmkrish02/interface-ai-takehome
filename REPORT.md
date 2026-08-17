# Design Write-up — Computer-Use Automation System

## 1. Architecture

The system is four components connected by one deliberate seam. A **mock bank app** (TypeScript/Express, server-rendered, intentionally hostile markup — table layouts, no test IDs, four routes: login, search, member detail, sub-account) stands in for a legacy back-office application with no API. A **discovery loop** drives that app in a real browser via Playwright, using Gemini (3.1-flash-lite) in an observe→decide→act cycle: it reads the page's accessibility snapshot, decides a single structured action, executes it, and records each successful action into an artifact. A **typed artifact** captures the resulting flow as a language-neutral, versioned capability. A **replay engine** — with no LLM anywhere — takes that artifact plus input parameters and executes it deterministically, returning a typed result.

The load-bearing decision is the **seam between perception and flow**: *how* the system observes and targets a surface is kept separate from *what* the recorded flow is. Discovery perceives via the accessibility tree and records each element as a **ranked locator chain** — a semantic strategy first (accessible label, then role), with a recorded xpath only as a last-resort fallback. Because the flow is stored independently of any one targeting strategy, the same artifact survives minor UI change (the chain degrades gracefully) and, in principle, could be executed against a different surface by swapping only the perception layer.

The other structural decision is that **discovery and replay are fully decoupled**: the artifact is the only thing that crosses between them. The model's transcript and reasoning are discarded; only the distilled, executable flow survives. This is what lets the expensive, non-deterministic discovery run happen once while the cheap, deterministic replay runs in production without a model in the loop.

Both programs share the same shape — a CLI entry point, an orchestrator (`loop.ts` for discovery, `engine.ts` for replay), and single-responsibility helpers — which keeps each file traceable to one job.

## 2. Artifact schema

The artifact is designed as a **callable capability, not a recording** — a function signature plus a body that a human reviewer and a calling agent can both read without seeing the discovery transcript. Its fields fall into three groups.

**Identity and contract.** `name`, `description`, and `version` let an agent discover the capability and let a reviewer track it across app changes (the brief's "versioned and reviewable" requirement). `target` (app, baseUrl, tenant) records which surface it was recorded against — the anchor for cross-tenant reuse. `parameters` are the typed inputs the caller supplies per invocation (e.g. `memberId`); `outputs` are the typed returns (e.g. `savingsBalance`). Together these form the function signature: a caller knows what to pass and what it gets back without reading a single step.

**The flow.** `steps` is the ordered action list. Each step carries an action (navigate/click/type/extract), a **ranked locator chain** (semantic label → role → xpath fallback), an optional `param` reference (so a type step injects `{memberId}` rather than a hardcoded literal — this is what makes the capability reusable across members), an optional `output` name (for extract steps), and an optional checkpoint asserting the expected post-condition.

**The outcome vocabulary.** `knownOutcomes` encodes the error taxonomy as data — each entry pairs a name (e.g. `MEMBER_NOT_FOUND`), the text to recognize on the rendered page, and its kind (business / recoverable / hard failure). A single `successCheckpoint` defines what proves the whole capability succeeded.

One deliberate split: **locators live per-step, but `knownOutcomes` lives at the artifact level.** A locator is local to one element in one step; "what can legitimately go wrong in this app" is global to the whole capability, so it is declared once and matched against on every step. This is also what keeps replay deterministic and model-free — the intelligence needed to recognize an outcome was captured once at discovery and written into the artifact as data, not re-derived at run time.

## 3. Determinism & error handling

Replay is deterministic along three axes. First, **no model is in the decision loop** — the same artifact and input parameters produce the same ordered steps on every run; the intelligence was spent once at discovery and discarded. Second, **element targeting uses ranked locator chains**: each step tries a semantic strategy first (accessible label, then role), falling back to a recorded xpath only as a last resort. In practice the semantic tiers carry the load — across the discovery run, all steps resolved via label or role and the xpath fallback never fired, which is both the intended behaviour and a drift signal: if xpath tiers begin winning on later replays, the UI has materially changed and the artifact is flagged for review. Third, **every step is checkpointed** — replay asserts the expected post-condition (text/element/url present) rather than assuming an action succeeded.

Error handling rests on a single principle: **runtime conditions are recognized, not inferred, and never classified on HTTP status** — legacy bank apps return HTTP 200 while rendering "Record not found," so the transport layer is useless as a discriminator. Instead, the artifact declares a vocabulary of known outcomes at discovery time, and replay matches the rendered page against it, in priority order:

- **Expected business outcomes** (e.g. `MEMBER_NOT_FOUND`, `PERMISSION_DENIED`) are enumerated, matched on rendered text, and returned to the caller as typed results — a legitimate answer, not a crash. Conflating these with failures is the most common design mistake in this problem, so the result contract makes them a distinct status.
- **Recoverable conditions** (e.g. a session-expired interstitial) trigger a bounded recovery action and a single retry of the current step; if still unresolved, they escalate.
- **Hard failures** are the residual — nothing in the declared vocabulary matched and the checkpoint failed. Replay stops and surfaces a structured, debuggable error (step index, expected vs. observed, screenshot) and routes to human escalation.

This is demonstrated end-to-end in `/evidence`: a success run returning the extracted balance, a `MEMBER_NOT_FOUND` business-outcome run on a non-existent member, and an escalation run where an unrecoverable state was detected and routed to a human with full context.

## 4. Heterogeneity & multi-tenant

**Heterogeneous surfaces.** The architecture separates **perception/action** (how a surface is observed and driven) from the **recorded flow** (the ordered intents that make up a capability). The artifact stores only the flow and its locator chains; a surface-specific adapter does the perceiving and acting. Today that adapter is Playwright over a browser's accessibility tree. Extending to a **legacy web app** requires no schema change — the same label/role locators degrade to structural/xpath fallbacks where semantics are missing. Extending to a **native desktop app** means swapping only the adapter: the OS-level accessibility API reads a native control tree instead of a DOM, but a step recorded as "the field labeled Member ID" is found by a different mechanism while the recorded step, the artifact schema, the replay engine, and the error taxonomy remain identical. The expensive, reusable machinery stays put; only the thin perception layer is surface-specific.

**Multi-tenant reuse.** Many tenants run the same vendor product, skinned and versioned differently. Rather than re-recording per tenant, an artifact is modeled as a **base plus thin per-tenant overrides**. The base holds the invariant flow and default locators, recorded once on a canonical instance; a tenant that differs supplies an override containing only the locators (or steps) that don't match — the search field labeled "Account Lookup" instead of "Member ID," for example. A tenant is a *diff* against the base, not a fork. **Override size is the drift gauge**: a small override means healthy reuse of the same underlying app; a growing override signals material divergence — likely a version difference — and flags the artifact for review or a full re-record. This is the same principle as canonicalizing concrete values into parameterized patterns (`/member/12345` → `/member/:id`): normalize what's shared, override only what genuinely differs.

## 5. Escalation & handoff

Replay escalates on two triggers. The first is an **unrecoverable state**: when classification yields a hard failure, or a recoverable condition remains unresolved after its bounded retry, replay cannot safely proceed. The second is a **risky/irreversible step**: steps flagged `risky` — in the mock, the sub-account confirmation — pause for human approval *before* acting, rather than waiting for something to break.

On either trigger, `escalation.ts` **pauses the run and raises an intervention request with full context** — the artifact name, the step index, expected vs. observed state, the current URL, and a screenshot — written to `evidence/escalations/` so the request is actionable, not a bare stack trace. The operator then **takes control of the same live browser session** the automation was using — not a fresh one — performs the manual step in the already-open window, and signals completion (pressing Enter in the mock operator surface). On resume, replay **re-checks the current state** against the checkpoint and known-outcome vocabulary — the human may have resolved it — and either continues from the next step or, if still unresolved, returns a structured hard failure. Context and evidence are preserved across the handoff, and the post-handoff session state is logged.

The operator UI itself is deliberately minimal — a CLI pause rather than a full co-browsing console — but the **control-transfer model is real**: automation pauses, cedes control on the same session, and resumes, with a recorded record of what the human did. In production the same model extends to a remote session: the operator and the automation share one browser context (via a remote-debugging/co-browsing connection), the automation cedes a control token, the human acts on the same live page, and control is handed back — the mechanism is identical; only the operator surface changes.

## 6. Safety

The guardrail model has three layers.

**Allowlist / target scoping.** An artifact declares its `target` (app + baseUrl), and replay operates only within that scope — it will not navigate or act outside the permitted surface. This is the boundary that keeps a capability from wandering off its intended app.

**Risky-action handling.** Actions are treated as either safe/reversible (reads, searches, navigation) or risky/irreversible (the sub-account confirmation — anything that mutates state). Risky steps are handled conservatively: they are flagged and routed through human approval via the escalation path *before* execution, rather than executed autonomously. The default posture for the irreversible class is "pause and confirm," not "proceed."

**Data redaction.** Regulated financial data and secrets are never persisted in artifacts or logs. Parameter *values* that are sensitive — credentials above all — are never written out; logs record the parameter *name* that fed a step (`"param": "password"`) but never its value. This was verified: a full-text search for the test password across all evidence returns nothing.

**Limits of the model — stated honestly.** The allowlist is coarse (domain/route level, not fine-grained per-action policy). Redaction currently keys on known-sensitive parameter names rather than detecting arbitrary PII in extracted output — a member name or balance read into `outputs` is not itself redacted, since it is the capability's legitimate return value; a production system would need field-level classification of what may be logged versus returned. The risky/safe split is currently a manual flag rather than a learned or policy-derived classification. And the discovery run itself sends page content to a model provider once — acceptable in a controlled discovery setting, but the reason replay is designed to never do so.

## 7. Cuts

Deliberately left out, at clean seams, in the interest of a complete-but-thin vertical slice:

- **Operator console UI.** Mocked as a CLI pause. The control-transfer *mechanism* is real (pause → same-session handoff → resume); only the operator's visual surface is stubbed. This is the seam the brief explicitly permits.
- **Multi-tenant base+override, built.** Designed (Section 4) but not implemented — a single tenant is exercised. The schema carries `target.tenant` so the override layer can be added without reshaping artifacts.
- **Desktop/legacy adapters, built.** The perception/flow seam is designed to support them (Section 4); only the browser adapter is implemented.
- **Confidence scoring & approval gates.** Discovery is non-deterministic, so a single recorded artifact is not proof it is the *right* one. A production system would score artifacts by replay reliability and gate unattended replay behind an approval state (draft → approved). Not built.
- **Assisted fallback on replay.** No bounded LLM recovery on replay failure — replay escalates to a human instead. This keeps the production path strictly model-free, at the cost of more human interventions.

**What I'd build next, in order:** (1) the base+override tenant layer, since it's designed and directly demonstrates generalization; (2) confidence scoring + a draft→approved gate, since it addresses the discovery-nondeterminism gap honestly; (3) field-level output redaction for real PII handling; (4) a second surface adapter (legacy frameset or desktop) to prove the perception seam.

---

### A note on review (found during this build)

During review of the discovery-generated artifact, one outcome (`PERMISSION_DENIED`) had been auto-classified by the model as a hard failure. It was corrected to a business outcome on human review — "not authorized" is a legitimate result the caller needs, not a crash. This is a concrete illustration of why the artifact must be *reviewable*, not auto-trusted: the schema exists precisely so a human can catch a miscategorization the discovery model made.
