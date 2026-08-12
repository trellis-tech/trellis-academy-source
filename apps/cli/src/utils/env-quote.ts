/**
 * Quote a value for a docker-compose `.env` file so docker compose's dotenv
 * parser preserves it *literally* — no interpolation of `$VAR`, no `#` comment
 * truncation, no whitespace trimming.
 *
 * Scheme (verified against `docker compose` with container `printenv`):
 *   - no special chars      → emit as-is
 *   - no single quote in it  → wrap in single quotes (fully literal, incl. `$`)
 *   - contains a single quote → wrap in double quotes, escaping `\`, `"`,
 *     and `$` for Docker Compose
 */
export function quoteEnvValue(value: string): string {
  if (value === '') return ''
  if (!/[\s#$'"\\`!]/.test(value)) return value
  if (!value.includes("'")) return `'${value}'`
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '$$$$')}"`
}
