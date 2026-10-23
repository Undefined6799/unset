// Web addresses a member writes on their profile: the website, their links and the README's links.

/** A web address as people type it: "alice.dev" means https://alice.dev; one with any scheme is left as it is. */
export const withScheme = (text: string) => (/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);

/** A plain http or https URL with a host and no credentials, as the lexicon's uri fields expect here. */
export function isWebsite(text: string): boolean {
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const url = new URL(text);
    return url.hostname !== "" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}
