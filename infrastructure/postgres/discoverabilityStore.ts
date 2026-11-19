// A member's own "Search and AI" choices (ADR 0062; migration 0031), read and saved for Settings › Profile. Every
// statement names the signed-in member's DID, the only row web touches here. A save that leaves everything off and
// empty deletes the row: no row is the same as all off, so nothing is kept that says nothing.
import { DISCOVERABILITY_OFF, type Discoverability } from "@unset/domains-profile";
import { type Pool, withClient } from "./pool.ts";

export type DiscoverabilityStore = {
  readonly get: (did: string, deadline: AbortSignal | null) => Promise<Discoverability>;
  readonly save: (did: string, value: Discoverability, deadline: AbortSignal | null) => Promise<void>;
};

type Row = {
  search_engines: boolean;
  ai_search: boolean;
  search_title: string | null;
  search_description: string | null;
};

const isOff = (v: Discoverability) => !v.searchEngines && !v.aiSearch && v.title === "" && v.description === "";

export function createDiscoverabilityStore(pool: Pool): DiscoverabilityStore {
  return {
    get: (did, deadline) =>
      withClient(pool, deadline, async (client) => {
        const { rows } = await client.query<Row>(
          `SELECT search_engines, ai_search, search_title, search_description FROM app.discoverability WHERE did = $1`,
          [did],
        );
        const row = rows[0];
        if (row === undefined) return DISCOVERABILITY_OFF;
        return {
          searchEngines: row.search_engines,
          aiSearch: row.ai_search,
          title: row.search_title ?? "",
          description: row.search_description ?? "",
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
