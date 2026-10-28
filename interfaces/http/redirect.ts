// The 303 See Other every form and gate in this process answers with: never cached, with any cookies the caller sets.

/** A 303 to `location`, `cache-control: no-store`, appending each cookie as its own `set-cookie`. */
export function redirect(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}
