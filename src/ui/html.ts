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
