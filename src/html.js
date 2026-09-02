/**
 * HTML templating that escapes by construction.
 *
 * Every interpolation is escaped unless it is already a SafeHtml value, so the safe thing
 * is the default and forgetting to escape is no longer possible. Views return SafeHtml,
 * which is what the Trusted Types policy checks for: markup that did not come from here
 * cannot reach innerHTML at all.
 */

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

function serialize(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(serialize).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let index = 0; index < values.length; index += 1) out += serialize(values[index]) + strings[index + 1];
  return new SafeHtml(out);
}

/**
 * Marks a string as markup we authored ourselves. Never pass anything derived from a
 * record, a tool argument, or anything else an agent or another person can influence.
 */
export function raw(value) { return new SafeHtml(String(value)); }
