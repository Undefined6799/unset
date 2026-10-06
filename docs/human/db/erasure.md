# DID columns and erasure

Erasure (`eraseDid`, P3.07) must reach every column that holds a DID (plan section 2 rule 11). The database itself is
the list: a column holds a DID when its type is one of the `types` domains, and
`tests/integration/postgres/did-columns.test.ts` fails while such a column has no row in
`infrastructure/postgres/erasure-registry.json` (P1.13).

## Adding a DID column

1. Declare the column as `types.did` (or `types.did[]`). An AT-URI column is `types.at_uri` (or `types.at_uri[]`): its
   authority is a DID, so it is a DID column too. Resolve a handle to its DID before storing a URI; a handle authority
   is refused.
2. In the same PR, add its row to `erasure-registry.json`, keyed `"<schema>.<table>.<column>"`:
   - `delete_row`: erasure deletes the row.
   - `set_null`: erasure sets the column to null; the column must be nullable.
   - `retain`: kept, with `class` (the retention class) and `reason` (why the law or the product needs it).
   - `audit_redact`: the audit side tables (P1.15a); erasure calls `audit.erase_subject(did)`. It needs `class: "mod"`
     and a `reason`.
   - `retain_legal_hold`: defined by P4.07; erasure skips held rows only.
3. P3.07 erases by the registry; nothing else needs a list.

A `text` column whose name looks like a DID (`did`, `*_did`, `*_uri`, `subject`, `actor`, `author`, `owner`, `target`)
fails the test unless it uses a domain. If it really holds no DID, list it in the test's `NOT_A_DID` with a comment
saying why. A DID inside a JSONB body is invisible to the catalog, so its table needs a domain column for the owning DID,
and that column's row covers the whole row.

`didColumns(pool)` in `infrastructure/postgres/didColumns.ts` is the one query that lists these columns; erasure and the
export (P4.26) use it rather than a copy.

## The domains

- `types.did`: `did:plc:` with 24 base32 characters, or `did:web:` with a lowercase host name and no port or path, as
  atproto uses it.
- `types.at_uri`: `at://<did>` with up to a collection and a record key. `types.at_uri_did(uri)` returns the authority as
  a `types.did`.

A domain check runs with the writer's rights, so `types.at_uri` validates its authority by a cast to `types.did`, not by
calling `types.at_uri_did`: routines are not executable by PUBLIC (migration `0003`), and the first step that calls the
helper (erasure, P3.07) grants it to its role.
