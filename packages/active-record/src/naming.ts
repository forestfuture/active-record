// camelCase attribute names to snake_case columns and back, as Rails' `underscore` and `camelize`.
/**
 * Converts a camelCase attribute name to its snake_case column name, treating
 * a run of capitals as one word (Rails' `underscore`): `htmlURL` → `html_url`,
 * `userID` → `user_id`, `sha256Hash` → `sha256_hash`.
 */
export function underscore(name: string): string {
  // Rails writes this as two substitutions; a capital gets an underscore before it after a
  // lowercase letter or digit, or after a capital or digit when a lowercase letter follows. Each
  // is a zero-width check at one position, so the time is linear in the name. A capture of a
  // whole run of capitals retries from every start, and is quadratic (#116).
  return name.replace(/(?<=[a-z\d])(?=[A-Z])|(?<=[A-Z\d])(?=[A-Z][a-z])/g, "_").toLowerCase();
}

/** A snake_case name as a camelCase attribute: `api_key` → `apiKey`. */
export function camelize(name: string): string {
  return name.replace(/_([a-z\d])/g, (_, letter: string) => letter.toUpperCase());
}
