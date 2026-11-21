// The public profile page's one read (book P3.12s; migration 0030). It reads only the two views 0030 grants `web`,
// which show visible accounts alone, so every state that hides an account (deactivated, deleted, erased, delisted,
// suspended) reads here as no row. The profile and its cards come back in one statement, so the page never shows
// cards from a different moment than the profile. The member's Search and AI choices (migration 0034) come with it. Records come back as stored; domains/profile reads them again.
import { type Discoverability, MAX_SECTIONS_PER_ACCOUNT } from "@unset/domains-profile";
import { type Pool, readUntilAbort, withClient } from "./pool.ts";

/** Who the page asks for: a DID from the path, or a handle the indexer verified (P3.08s). */
export type PublicActor = { readonly did: string } | { readonly handle: string };

export type PublicProfile = {
  readonly did: string;
  /** The verified handle, or null when the indexer has not verified one. */
  readonly handle: string | null;
  readonly cid: string;
  readonly record: unknown;
  /** The member's cards, at most MAX_SECTIONS_PER_ACCOUNT, by record key; `pageCards` sets the page's order. */
  readonly sections: readonly { readonly key: string; readonly cid: string; readonly value: unknown }[];
  /** The member's Search and AI choices (ADR 0062); all off when they made none. */
  readonly discoverability: Discoverability;
};

/** A listed member's page: its DID and verified handle, for the path (`canonicalActorPath`). */
export type ListedPage = { readonly did: string; readonly handle: string | null };

export type PublicProfileStore = {
  /** The visible account's published profile, or null for anything else. */
  readonly find: (actor: PublicActor, deadline: AbortSignal | null) => Promise<PublicProfile | null>;
  /**
   * The visible members who turned a switch on, at most `limit`, by DID: `searchEngines` for the sitemap, `aiSearch`
   * for robots.txt's AI search lines.
   */
  readonly listed: (
    choice: "searchEngines" | "aiSearch",
    limit: number,
    deadline: AbortSignal | null,
  ) => Promise<ListedPage[]>;
};

type Row = {
  did: string;
  handle: string | null;
  cid: string;
  record: unknown;
  sections: PublicProfile["sections"];
  search_engines: boolean | null;
  ai_search: boolean | null;
  search_title: string | null;
  search_description: string | null;
};

// Two rows for one handle would be the indexer's error (P3.08s keeps a verified handle on one account): the page
// then shows neither rather than guess, so the query asks for two to see it.
const SELECT = `
  SELECT p.did, p.handle, p.cid, p.record,
         d.search_engines, d.ai_search, d.search_title, d.search_description,
         coalesce((SELECT json_agg(json_build_object('key', s.rkey, 'cid', s.cid, 'value', s.record) ORDER BY s.rkey)
                     FROM (SELECT rkey, cid, record FROM idx.public_section
                            WHERE did = p.did ORDER BY rkey LIMIT $2) s), '[]'::json) AS sections
    FROM idx.public_profile p
    LEFT JOIN app.discoverability d USING (did)`;
const BY_DID = `${SELECT} WHERE p.did = $1 LIMIT 2`;
const BY_HANDLE = `${SELECT} WHERE p.handle = $1 LIMIT 2`;
// A page shown to fewer than everyone is never listed, whatever the switches say (ADR 0078): only a record with no
// visibility, or "public", counts, as domains/profile readProfileVisibility reads it (anything else fails closed).
const PUBLIC_PAGE = `(NOT p.record ? 'visibility' OR p.record->'visibility' = '"public"'::jsonb)`;
// The column is chosen from two fixed names, never from input.
const LISTED = {
  searchEngines: `SELECT p.did, p.handle FROM idx.public_profile p JOIN app.discoverability d USING (did)
                   WHERE d.search_engines AND ${PUBLIC_PAGE} ORDER BY p.did LIMIT $1`,
  aiSearch: `SELECT p.did, p.handle FROM idx.public_profile p JOIN app.discoverability d USING (did)
              WHERE d.ai_search AND ${PUBLIC_PAGE} ORDER BY p.did LIMIT $1`,
} as const;

export function createPublicProfileStore(pool: Pool): PublicProfileStore {
  return {
    find: (actor, deadline) =>
      withClient(pool, deadline, async (client) => {
        const [sql, key] = "did" in actor ? [BY_DID, actor.did] : [BY_HANDLE, actor.handle];
        // The query itself stops at the deadline, not only the wait for a connection (pool.ts readUntilAbort).
        const { rows } = await readUntilAbort(
          client,
          deadline ?? undefined,
          client.query<Row>(sql, [key, MAX_SECTIONS_PER_ACCOUNT]),
        );
        const row = rows.length === 1 ? rows[0] : undefined;
        if (row === undefined) return null;
        return {
          did: row.did,
          handle: row.handle,
          cid: row.cid,
          record: row.record,
          sections: row.sections,
          discoverability: {
            searchEngines: row.search_engines === true,
            aiSearch: row.ai_search === true,
            title: row.search_title ?? "",
            description: row.search_description ?? "",
          },
        };
      }),
    listed: (choice, limit, deadline) =>
      withClient(pool, deadline, async (client) => {
        const { rows } = await client.query<ListedPage>(LISTED[choice], [limit]);
        return rows.map(({ did, handle }) => ({ did, handle }));
      }),
  };
}
