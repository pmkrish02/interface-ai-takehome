import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";
import type { SimplifiedNode } from "./accessibility";
import type { Credentials, ModelAction } from "./types";
import { MOCK_BANK_KNOWN_OUTCOMES } from "./knownOutcomes";

// gemini-3.1-pro returned 404/no-quota on the dev key used for this project
// (see CLAUDE.md decisions log) — gemini-3.1-flash-lite is the verified
// working default. Overridable via GEMINI_MODEL for other accounts/keys.
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

// Flat schema covering the union of all action shapes. Gemini's structured
// output does not support oneOf/discriminated unions reliably, so every
// field is optional except "action"; the parser below validates the
// combination actually required for the chosen action.
const ACTION_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    action: {
      type: SchemaType.STRING,
      enum: ["navigate", "click", "type", "extract", "done"],
      format: "enum",
    },
    url: { type: SchemaType.STRING },
    target: {
      type: SchemaType.OBJECT,
      properties: {
        by: {
          type: SchemaType.STRING,
          enum: ["label", "role", "placeholder"],
          format: "enum",
        },
        text: { type: SchemaType.STRING },
        role: { type: SchemaType.STRING },
        name: { type: SchemaType.STRING },
      },
      required: ["by", "text", "role", "name"],
    },
    value: { type: SchemaType.STRING },
    outputName: { type: SchemaType.STRING },
    reason: { type: SchemaType.STRING },
  },
  required: ["action"],
};

function systemInstruction(credentials: Credentials): string {
  const outcomeLines = MOCK_BANK_KNOWN_OUTCOMES.map(
    (o) => `- ${o.name}: rendered text "${o.match}" (${o.kind})`
  ).join("\n");

  return `You are driving a real browser, one action per turn, to accomplish a goal in a
legacy bank back-office web app. You will be given the current URL and a
pruned accessibility tree (role/name/value only — the underlying HTML is
deliberately hostile table markup, so the accessibility tree is the only
reliable view). Respond with exactly one JSON action per turn matching the
provided schema. Do not explain yourself outside the JSON. The schema
requires every field of "target" to be present (by, text, role, name) even
though only some apply to a given "by" value — set the fields that don't
apply to "" (empty string), never omit them.

Action semantics:
- "navigate": go to an absolute url.
- "click": click the element resolved by "target". Prefer target.by = "label"
  for form fields (every input has a paired <label>), "role" for buttons and
  links (e.g. role "button" name "Login", role "link" name "Open Sub-Account"),
  "placeholder" only if nothing else applies.
- "type": fill the element resolved by "target" with "value".
- "extract": read the text at the element resolved by "target" and store it
  under "outputName" (short, camelCase, describes what was read, e.g.
  "savingsBalance"). Use this for any value the goal asks you to read/report.
  For a display value shown as "<label>Some Label</label>" next to its value
  in the accessibility tree, use target.by = "label" with target.text set to
  the LABEL text (e.g. "Savings Balance"), never the value itself and never
  target.by = "role" — the value has no discoverable role/name pair, only
  the label does.
- "done": the goal is accomplished (or definitively cannot be, e.g. a known
  business outcome like member-not-found was reached). Give a one-sentence
  "reason". This ends the run.

Login credentials for this app: username "${credentials.username}", password
"${credentials.password}". Log in first if you are not already authenticated
(the login form has "Username" and "Password" labeled fields and a "Login"
button).

Known UI outcomes this app can render (these are rendered text, not HTTP
status — a "not found" or "not authorized" screen can still be HTTP 200):
${outcomeLines}
If you land on one of these screens, treat it as the terminal state and call
"done" describing what happened rather than retrying blindly.

Take the most direct path. Do not click around exploring — pick the action
that makes progress toward the goal given the current screen.`;
}

export interface GeminiDecider {
  decide(params: {
    goal: string;
    url: string;
    a11yTree: SimplifiedNode | null;
    history: string[]; // short one-line summaries of prior actions taken
    stepsRemaining: number;
  }): Promise<ModelAction>;
}

export function createGeminiDecider(apiKey: string, credentials: Credentials): GeminiDecider {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: systemInstruction(credentials),
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: ACTION_SCHEMA,
    },
  });

  return {
    async decide({ goal, url, a11yTree, history, stepsRemaining }) {
      const prompt = [
        `Goal: ${goal}`,
        `Current URL: ${url}`,
        `Steps remaining: ${stepsRemaining}`,
        history.length > 0
          ? `Actions taken so far:\n${history.map((h, i) => `${i + 1}. ${h}`).join("\n")}`
          : "Actions taken so far: none",
        `Accessibility tree (JSON):\n${JSON.stringify(a11yTree ?? {})}`,
      ].join("\n\n");

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      try {
        return parseModelAction(text);
      } catch (e) {
        // Surface the raw (bounded) response so evidence logs show *why*
        // parsing failed instead of just "parse_error".
        throw new Error(`${(e as Error).message} — raw response: ${text.slice(0, 500)}`);
      }
    },
  };
}

export function parseModelAction(raw: string): ModelAction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`model did not return valid JSON: ${(e as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("model JSON was not an object");
  }
  const p = parsed as Record<string, unknown>;

  switch (p.action) {
    case "navigate":
      if (typeof p.url !== "string") throw new Error("navigate action missing url");
      return { action: "navigate", url: p.url };
    case "click": {
      const target = requireTarget(p.target);
      return { action: "click", target };
    }
    case "type": {
      const target = requireTarget(p.target);
      if (typeof p.value !== "string") throw new Error("type action missing value");
      return { action: "type", target, value: p.value };
    }
    case "extract": {
      const target = requireTarget(p.target);
      if (typeof p.outputName !== "string") throw new Error("extract action missing outputName");
      return { action: "extract", target, outputName: p.outputName };
    }
    case "done":
      return { action: "done", reason: typeof p.reason === "string" ? p.reason : "" };
    default:
      throw new Error(`unknown action kind: ${String(p.action)}`);
  }
}

function requireTarget(raw: unknown): import("./types").ActionTarget {
  if (typeof raw !== "object" || raw === null) throw new Error("action missing target");
  const t = raw as Record<string, unknown>;
  if (t.by !== "label" && t.by !== "role" && t.by !== "placeholder") {
    throw new Error(`invalid target.by: ${String(t.by)}`);
  }
  if (t.by === "role") {
    if (typeof t.role !== "string" || !t.role || typeof t.name !== "string" || !t.name) {
      throw new Error("role target missing role/name");
    }
    return { by: "role", role: t.role, name: t.name };
  }
  if (typeof t.text !== "string" || !t.text) {
    throw new Error(`${t.by} target missing text`);
  }
  return { by: t.by, text: t.text };
}
