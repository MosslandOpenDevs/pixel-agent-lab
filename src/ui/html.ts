/**
 * Escapes a value for HTML text or a double-quoted attribute.
 *
 * One implementation for every innerHTML sink. It takes `unknown` rather than
 * `string` on purpose: the values it guards come from other services' JSON
 * behind unchecked casts, and a version typed for strings — calling `.replace`
 * directly — threw on the first number or `null` it was handed, inside a hover
 * handler.
 */
export const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/**
 * A value only when it is real text, and "" otherwise.
 *
 * The companion to `esc` for sinks that do string work — `.slice`, `.length`,
 * `.toUpperCase` — rather than interpolation. Those throw on the number or
 * object another service can put in a field typed `string`, and `String(v)`
 * is no fix: it would print "[object Object]" on the belt. Callers that want
 * a stand-in supply it themselves: `str(a) || str(b) || "Idea"`.
 */
export const str = (v: unknown): string => (typeof v === "string" ? v : "");
