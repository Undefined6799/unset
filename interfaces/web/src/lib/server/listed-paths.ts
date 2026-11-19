// The profile paths robots.txt and the sitemap list (ADR 0062): each listed member's canonical path, as the public page
// itself redirects to it (a verified handle, else the DID). A DID or handle that no longer parses is left out, never
// guessed.
import { canonicalActorPath, parseDid, parseHandle } from "@unset/domains-identity";
import type { ListedPage } from "@unset/infrastructure-postgres";

export function listedPaths(pages: readonly ListedPage[]): string[] {
  const paths: string[] = [];
  for (const page of pages) {
    const did = parseDid(page.did);
    if (did === null) continue;
    paths.push(canonicalActorPath(page.handle === null ? null : parseHandle(page.handle), did));
  }
  return paths;
}
