/**
 * Parse a comma-separated list string into a trimmed array.
 * Empty/undefined input returns an empty array.
 */
export function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}
