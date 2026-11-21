// The public profile page's one read (book P3.12s; migration 0030). It reads only the views 0030 and 0042 grant `web`,
// which show visible accounts alone, so every state that hides an account (deactivated, deleted, erased, delisted,
// suspended) reads here as no row (the main page too, migration 0042). The profile, its page and its cards come back in one statement, so the page never shows
// cards from a different moment than the profile. The member's Search and AI choices (migration 0034) come with it. Records come back as stored; domains/profile reads them again.
// Each card is its own row, in page order, and the read stops at MAX_PAGE_BYTES of cards (migration 0040), so one
// page never makes web hold more than that, whatever the index holds (review of #1911).
import { type Discoverability, MAX_PAGE_BYTES, MAX_SECTIONS_PER_ACCOUNT } from "@unset/domains-profile";
import { type Pool, readUntilAbort, withClient } from "./pool.ts";

/** Who the page asks for: a DID from the path, or a handle the indexer verified (P3.08s). */
export type PublicActor = { readonly did: string } | { readonly handle: string };

export type PublicProfile = {
  readonly did: string;
  /** The verified handle, or null when the indexer has not verified one. */
  readonly handle: string | null;
  readonly cid: string;
  readonly record: unknown;
  /** The member's main page record (ADR 0091), which lists the cards it shows; null when they have none. */
  readonly page: unknown;
  /**
   * The member's cards, at most MAX_SECTIONS_PER_ACCOUNT and MAX_PAGE_BYTES together: the ones the main page lists,
   * in its order, then the rest by record key, cut where the next would pass the budget. `pageCards` sets the page's order.
   */
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

/** The profile's row (`n` 0) or one card's (`n` its place, from 1): the columns the other kind has not are null. */
type Row = {
  n: string;
  did: string;
  handle: string | null;
  cid: string;
  record: unknown;
  page_record: unknown;
  rkey: string | null;
  search_engines: boolean | null;
  ai_search: boolean | null;
  search_title: string | null;
  search_description: string | null;
};

// Two rows for one handle would be the indexer's error (P3.08s keeps a verified handle on one account): the page
// then shows neither rather than guess, so the query asks for two to see it.
// The cards are read only for exactly one profile row, and only while the running total of their sizes (in page order,
// as the indexer stored them) stays within $3.
const pageOf = (where: string) => `
  WITH page AS (
    SELECT p.did, p.handle, p.cid, p.record, g.record AS page_record,
           d.search_engines, d.ai_search, d.search_title, d.search_description
      FROM idx.public_profile p
      LEFT JOIN idx.public_page g USING (did)
      LEFT JOIN app.discoverability d USING (did)
     WHERE ${where} LIMIT 2),
  cards AS (
    SELECT s.rkey, s.cid, s.record,
           row_number() OVER w AS n, sum(s.bytes) OVER (w ROWS UNBOUNDED PRECEDING) AS total
      FROM idx.public_section s
     WHERE s.did IN (SELECT did FROM page) AND (SELECT count(*) FROM page) = 1
    WINDOW w AS (ORDER BY s.position NULLS LAST, s.rkey))
  SELECT 0::bigint AS n, did, handle, cid, record, page_record, NULL::text AS rkey,
         search_engines, ai_search, search_title, search_description
    FROM page
  UNION ALL
  SELECT n, NULL, NULL, cid, record, NULL, rkey, NULL, NULL, NULL, NULL
    FROM cards WHERE n <= $2 AND total <= $3
  ORDER BY n`;
const BY_DID = pageOf("p.did = $1");
const BY_HANDLE = pageOf("p.handle = $1");
// A page shown to fewer than everyone is never listed, whatever the switches say (ADR 0078): only a record with no
// visibility, or "public", counts, as domains/profile readPageVisibility reads it (anything else fails closed).
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
          client.query<Row>(sql, [key, MAX_SECTIONS_PER_ACCOUNT, MAX_PAGE_BYTES]),
        );
        const pages = rows.filter((r) => r.n === "0");
        const row = pages.length === 1 ? pages[0] : undefined;
        if (row === undefined) return null;
        const cards = rows.filter((r) => r.n !== "0" && r.rkey !== null);
        return {
          did: row.did,
          handle: row.handle,
          cid: row.cid,
          record: row.record,
          page: row.page_record ?? null,
          sections: cards.map((r) => ({ key: r.rkey as string, cid: r.cid, value: r.record })),
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
