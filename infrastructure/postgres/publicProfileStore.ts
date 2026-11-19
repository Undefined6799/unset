// The public profile page's one read (book P3.12s; migration 0030). It reads only the two views 0030 grants `web`,
// which show visible accounts alone, so every state that hides an account (deactivated, deleted, erased, delisted,
// suspended) reads here as no row. The profile and its cards come back in one statement, so the page never shows
// cards from a different moment than the profile. Records come back as stored; domains/profile reads them again.
import { MAX_SECTIONS_PER_ACCOUNT } from "@unset/domains-profile";
import { type Pool, withClient } from "./pool.ts";

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
};

export type PublicProfileStore = {
  /** The visible account's published profile, or null for anything else. */
  readonly find: (actor: PublicActor, deadline: AbortSignal | null) => Promise<PublicProfile | null>;
};

type Row = {
  did: string;
  handle: string | null;
  cid: string;
  record: unknown;
  sections: PublicProfile["sections"];
};

// Two rows for one handle would be the indexer's error (P3.08s keeps a verified handle on one account): the page
// then shows neither rather than guess, so the query asks for two to see it.
const SELECT = `
  SELECT p.did, p.handle, p.cid, p.record,
         coalesce((SELECT json_agg(json_build_object('key', s.rkey, 'cid', s.cid, 'value', s.record) ORDER BY s.rkey)
                     FROM (SELECT rkey, cid, record FROM idx.public_section
                            WHERE did = p.did ORDER BY rkey LIMIT $2) s), '[]'::json) AS sections
    FROM idx.public_profile p`;
const BY_DID = `${SELECT} WHERE p.did = $1 LIMIT 2`;
const BY_HANDLE = `${SELECT} WHERE p.handle = $1 LIMIT 2`;

export function createPublicProfileStore(pool: Pool): PublicProfileStore {
  return {
    find: (actor, deadline) =>
      withClient(pool, deadline, async (client) => {
        const [sql, key] = "did" in actor ? [BY_DID, actor.did] : [BY_HANDLE, actor.handle];
        const { rows } = await client.query<Row>(sql, [key, MAX_SECTIONS_PER_ACCOUNT]);
        const row = rows.length === 1 ? rows[0] : undefined;
        if (row === undefined) return null;
        return {
          did: row.did,
          handle: row.handle,
          cid: row.cid,
          record: row.record,
          sections: row.sections,
        };
      }),
  };
}
