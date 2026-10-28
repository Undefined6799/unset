// Reading one field from a form body or query string, the way every route in this process does.

/** The one value of `name`, or null when it is missing or repeated. */
export function single(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 ? (values[0] ?? null) : null;
}
