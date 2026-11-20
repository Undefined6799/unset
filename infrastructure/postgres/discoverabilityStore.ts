// A member's own "Search and AI" choices (ADR 0062; migration 0034), read and saved for Settings › Privacy. Every
// statement names the signed-in member's DID, the only row web touches here. A save that leaves everything off and
// empty deletes the row: no row is the same as all off, so nothing is kept that says nothing.
import { DISCOVERABILITY_OFF, type Discoverability } from "@unset/domains-profile";
import { type Pool, withClient } from "./pool.ts";

/**
 * The member's choices and their public page as the index shows it (P1.21y): the handle the indexer verified, so
 * the settings preview names the page by the address /@<handle> serves; `page` is null while the index shows no page
 * (not indexed yet, or hidden).
 */
export type OwnDiscoverability = {
  readonly choices: Discoverability;
  readonly page: { readonly handle: string | null } | null;
};

export type DiscoverabilityStore = {
  readonly get: (did: string, deadline: AbortSignal | null) => Promise<OwnDiscoverability>;
  readonly save: (did: string, value: Discoverability, deadline: AbortSignal | null) => Promise<void>;
};

type Row = {
  search_engines: boolean | null;
  ai_search: boolean | null;
  search_title: string | null;
  search_description: string | null;
  page_did: string | null;
  handle: string | null;
};

const isOff = (v: Discoverability) => !v.searchEngines && !v.aiSearch && v.title === "" && v.description === "";

export function createDiscoverabilityStore(pool: Pool): DiscoverabilityStore {
  return {
    get: (did, deadline) =>
      withClient(pool, deadline, async (client) => {
        // One statement for both (the settings page's query budget): either side may have no row.
        const { rows } = await client.query<Row>(
          `SELECT d.search_engines, d.ai_search, d.search_title, d.search_description, p.did AS page_did, p.handle
             FROM (SELECT $1::text AS did) me
             LEFT JOIN app.discoverability d ON d.did = me.did
             LEFT JOIN idx.public_profile p ON p.did = me.did
            LIMIT 1`,
          [did],
        );
        const row = rows[0];
        const page = row?.page_did == null ? null : { handle: row.handle };
        if (row?.search_engines == null) return { choices: DISCOVERABILITY_OFF, page };
        return {
          choices: {
            searchEngines: row.search_engines,
            aiSearch: row.ai_search ?? false,
            title: row.search_title ?? "",
            description: row.search_description ?? "",
          },
          page,
        };
      }),
    save: (did, value, deadline) =>
      withClient(pool, deadline, async (client) => {
        if (isOff(value)) {
          await client.query("DELETE FROM app.discoverability WHERE did = $1", [did]);
          return;
        }
        // One statement, so two saves at once leave the later one; no read-decide-write (rule DA-4).
        await client.query(
          `INSERT INTO app.discoverability (did, search_engines, ai_search, search_title, search_description, updated_at)
           VALUES ($1, $2, $3, nullif($4, ''), nullif($5, ''), now())
           ON CONFLICT (did) DO UPDATE SET search_engines = excluded.search_engines, ai_search = excluded.ai_search,
             search_title = excluded.search_title, search_description = excluded.search_description,
             updated_at = excluded.updated_at`,
          [did, value.searchEngines, value.aiSearch, value.title, value.description],
        );
      }),
  };
}
