"use strict";
/**
 * Artifact schema — the typed, language-neutral output of discovery and the
 * sole input to replay. See CLAUDE.md: LLM discovers a flow once, replay is
 * deterministic against this shape (rule #3, LLM OUT OF REPLAY).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isArtifact = isArtifact;
// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------
function isString(x) {
    return typeof x === "string";
}
function isBoolean(x) {
    return typeof x === "boolean";
}
function isPrimitiveType(x) {
    return x === "string" || x === "number";
}
function isLocatorStrategy(x) {
    if (typeof x !== "object" || x === null)
        return false;
    const s = x;
    switch (s.by) {
        case "label":
            return isString(s.text);
        case "role":
            return isString(s.role) && isString(s.name);
        case "placeholder":
            return isString(s.text);
        case "xpath":
            return isString(s.value);
        default:
            return false;
    }
}
function isLocator(x) {
    if (typeof x !== "object" || x === null)
        return false;
    const l = x;
    return Array.isArray(l.strategies) && l.strategies.every(isLocatorStrategy);
}
function isCheckpoint(x) {
    if (typeof x !== "object" || x === null)
        return false;
    const c = x;
    return ((c.type === "textPresent" ||
        c.type === "elementPresent" ||
        c.type === "urlMatches") &&
        isString(c.value));
}
function isStep(x) {
    if (typeof x !== "object" || x === null)
        return false;
    const s = x;
    if (s.action !== "navigate" &&
        s.action !== "click" &&
        s.action !== "type" &&
        s.action !== "extract") {
        return false;
    }
    if (s.locator !== undefined && !isLocator(s.locator))
        return false;
    if (s.url !== undefined && !isString(s.url))
        return false;
    if (s.param !== undefined && !isString(s.param))
        return false;
    if (s.output !== undefined && !isString(s.output))
        return false;
    if (s.checkpoint !== undefined && !isCheckpoint(s.checkpoint))
        return false;
    return true;
}
function isParameter(x) {
    if (typeof x !== "object" || x === null)
        return false;
    const p = x;
    return isString(p.name) && isPrimitiveType(p.type) && isBoolean(p.required);
}
function isOutput(x) {
    if (typeof x !== "object" || x === null)
        return false;
    const o = x;
    return isString(o.name) && isPrimitiveType(o.type);
}
function isKnownOutcome(x) {
    if (typeof x !== "object" || x === null)
        return false;
    const k = x;
    if (!isString(k.name) || !isString(k.match))
        return false;
    if (k.kind !== "business_outcome" &&
        k.kind !== "recoverable" &&
        k.kind !== "hard_failure") {
        return false;
    }
    if (k.action !== undefined &&
        k.action !== "relogin" &&
        k.action !== "retry" &&
        k.action !== "dismiss") {
        return false;
    }
    return true;
}
function isTarget(x) {
    if (typeof x !== "object" || x === null)
        return false;
    const t = x;
    return isString(t.app) && isString(t.baseUrl) && isString(t.tenant);
}
function isArtifact(x) {
    if (typeof x !== "object" || x === null)
        return false;
    const a = x;
    return (isString(a.name) &&
        isString(a.description) &&
        isString(a.version) &&
        isTarget(a.target) &&
        Array.isArray(a.parameters) &&
        a.parameters.every(isParameter) &&
        Array.isArray(a.outputs) &&
        a.outputs.every(isOutput) &&
        Array.isArray(a.steps) &&
        a.steps.every(isStep) &&
        Array.isArray(a.knownOutcomes) &&
        a.knownOutcomes.every(isKnownOutcome) &&
        isCheckpoint(a.successCheckpoint));
}
