# Computer-Use Automation System

An LLM discovers a UI flow once, records it as a typed, versioned **artifact**, and a
**deterministic replay engine** re-runs that artifact in production with **no LLM in the
decision loop**. When replay can't safely proceed, it escalates to a human who takes control
of the same live browser session and hands control back. Built for legacy back-office
surfaces that expose no API and no clean DOM.

- **Discovery** — Gemini drives a real browser (Playwright), observing the accessibility
  tree and recording each action into an artifact.
- **Artifact** — a language-neutral, versioned capability: typed inputs/outputs, ordered
  steps with ranked locator chains, a declared outcome vocabulary, and a success checkpoint.
- **Replay** — executes the artifact deterministically, classifies runtime conditions
  (business outcome / recoverable / hard failure), and escalates when stuck.

See `REPORT.md` for the design write-up and `evidence/` for a full end-to-end demonstration.

## Repository layout

```
mock-bank/    A deliberately hostile legacy-style bank app (Express + EJS, no test IDs).
              Stands in for the target system; not part of the automation itself.
shared/       The artifact + result type definitions, shared by discovery and replay.
discovery/    The LLM observe→decide→act loop that records an artifact.
replay/       The no-LLM deterministic executor + error taxonomy + escalation.
evidence/     Recorded artifact, discovery logs, replay logs, escalation records.
```

## Prerequisites

- Node.js 18+
- A Gemini API key (discovery only — replay needs no model)

## Setup

Install each package:

```bash
cd mock-bank && npm install && cd ..
cd shared    && npm install && npm run build && cd ..
cd discovery && npm install && cd ..
cd replay    && npm install && cd ..
```

Add your Gemini key to a `.env` file at the repo root (kept out of git):

```bash
echo "GEMINI_API_KEY=your-key-here" > .env
```

The default discovery model is set in `discovery/` and can be overridden with
`GEMINI_MODEL=<model>` if your key enables a different one.

## Demo path

**1. Start the mock bank** (leave running in its own terminal):

```bash
cd mock-bank && npm run dev
# serves http://localhost:3000  (login: admin / password123)
```

**2. Run discovery** — the LLM accomplishes the goal and records an artifact:

```bash
cd discovery
npm run discover -- --goal "look up member 12345 and read their savings balance"
# writes evidence/artifacts/<name>.json and evidence/discovery/<timestamp>.jsonl
```

**3. Replay the artifact deterministically** (no LLM) — success path:

```bash
cd replay
npm run replay -- \
  --artifact ../evidence/artifacts/look-up-member-12345-and-read-their-savings-balance.json \
  --params '{"username":"admin","password":"password123","memberId":"12345"}'
# => Result: success   Outputs: { "savingsBalance": "$4,200.00" }
```

**4. Replay hitting a business outcome** — a member that doesn't exist:

```bash
npm run replay -- \
  --artifact ../evidence/artifacts/look-up-member-12345-and-read-their-savings-balance.json \
  --params '{"username":"admin","password":"password123","memberId":"99999"}'
# => Result: business_outcome   Outcome: MEMBER_NOT_FOUND   (a legitimate result, not a crash)
```

**Escalation** fires automatically when replay hits a state it cannot recover from
(for example, if the mock bank is not running, or on a step flagged risky). It pauses,
writes an intervention request with context and a screenshot to `evidence/escalations/`,
and waits for a human to take control of the open browser and press Enter to resume.

## Running without live services

Replay requires the mock bank running (it drives a real browser). Discovery additionally
requires a Gemini key. Pre-recorded artifacts and logs from a real discovery run and real
replay runs are committed under `evidence/`, so the end-to-end result can be inspected
without re-running anything.

## Safety notes

- Secrets and credentials are never written to artifacts or logs — logs record the
  parameter *name* that fed a step, never its value.
- Replay operates only within the artifact's declared `target` scope.
- Risky/irreversible steps are routed through human approval rather than executed
  autonomously.
