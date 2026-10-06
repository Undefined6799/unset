// The grant-matrix reader for grants.test.ts (P1.12; plan §5.2): the catalog as facts, the checked-in matrix as the
// same facts, the diff between them, and the rules that hold whatever the matrix says. It reads `pg_catalog`, not
// `information_schema`, so a privilege a role holds on every column only through a table-level grant stays one
// table-level fact (column grants are read from `attacl` itself).
import { type Pool, withClient } from "../../../infrastructure/postgres/index.ts";

/** The schemas whose objects the matrix covers; `plugin_<id>` schemas join them (decision 25). */
export const SCHEMAS = ["app", "idx", "audit", "types", "public"];
const AUDITOR_TABLES = ["audit.chain", "audit.segment", "audit.redaction_log"];

export type Privileges = string[];
export type TableEntry = Privileges | { privileges: Privileges; wholeTable: true } | ColumnEntry;
export type ColumnEntry = { columns: Record<string, Privileges>; rowPrivileges?: Privileges };
export type SchemaEntry = {
  owner?: string;
  grants?: Record<string, Privileges>;
  /** creating role → object kind → grantee → privileges, as pg_default_acl stores them. */
  defaults?: Record<string, Record<string, Record<string, Privileges>>>;
};
export type Matrix = {
  tables: Record<string, Record<string, TableEntry>>;
  schemas: Record<string, SchemaEntry>;
  roles: Record<string, { database: Privileges; memberOf: string[] }>;
  pluginRule: { schemaPrefix: string };
};
export type RosterRole = {
  name: string;
  class: "service" | "job" | "group" | "owner" | "human";
  login: boolean;
  connectionLimit: number | null;
  settings: Record<string, string>;
  passwordFrom: string | null;
};

/** One privilege a role holds on one object, from the catalog. `column` is set for a column grant. */
export type Grant = { object: string; kind: string; column: string | null; role: string; privilege: string };
/** What the catalog says, in the shapes the checks need. */
export type State = {
  grants: Grant[];
  schemas: { name: string; owner: string; grants: { role: string; privilege: string }[] }[];
  defaults: { creator: string; schema: string; kind: string; role: string; privilege: string }[];
  database: { role: string; privilege: string }[];
  memberships: { role: string; member: string }[];
  roles: {
    name: string;
    login: boolean;
    limit: number;
    /** The bootstrap superuser initdb creates (oid 10), the one role allowed SUPERUSER. */
    bootstrap: boolean;
    superuser: boolean;
    createdb: boolean;
    createrole: boolean;
    replication: boolean;
    bypassrls: boolean;
    settings: string[];
  }[];
  /** Every schema in the database, for the no-CREATE rule. */
  allSchemas: string[];
};

// ---- Reading the catalog ----

const grantee = (column: string) => `CASE WHEN ${column} = 0 THEN 'PUBLIC' ELSE ${column}::regrole::text END`;
const inScope = "(n.nspname = ANY($1) OR n.nspname LIKE 'plugin\\_%')";

export async function readState(pool: Pool): Promise<State> {
  return withClient(pool, null, async (client) => {
    const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
      (await client.query(sql, params)).rows as T[];
    const relations = await rows<Grant>(
      `SELECT n.nspname || '.' || c.relname AS object, c.relkind::text AS kind, NULL AS column,
              ${grantee("a.grantee")} AS role, a.privilege_type AS privilege
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
              pg_catalog.aclexplode(c.relacl) a
        WHERE ${inScope} AND a.grantee <> c.relowner`,
      [SCHEMAS],
    );
    const columns = await rows<Grant>(
      `SELECT n.nspname || '.' || c.relname AS object, c.relkind::text AS kind, att.attname::text AS column,
              ${grantee("a.grantee")} AS role, a.privilege_type AS privilege
         FROM pg_catalog.pg_attribute att JOIN pg_catalog.pg_class c ON c.oid = att.attrelid
              JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace, pg_catalog.aclexplode(att.attacl) a
        WHERE ${inScope} AND att.attnum > 0 AND NOT att.attisdropped AND a.grantee <> c.relowner`,
      [SCHEMAS],
    );
    // A routine without an ACL has the default one, which lets PUBLIC execute it.
    const routines = await rows<Grant>(
      `SELECT n.nspname || '.' || p.proname AS object, 'routine' AS kind, NULL AS column,
              ${grantee("a.grantee")} AS role, a.privilege_type AS privilege
         FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace,
              pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        WHERE ${inScope} AND a.grantee <> p.proowner
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                           WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')`,
      [SCHEMAS],
    );
    const schemaRows = await rows<{ name: string; owner: string; role: string | null; privilege: string | null }>(
      `SELECT n.nspname AS name, n.nspowner::regrole::text AS owner, ${grantee("a.grantee")} AS role,
              a.privilege_type AS privilege
         FROM pg_catalog.pg_namespace n
         LEFT JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a ON a.grantee <> n.nspowner
        WHERE ${inScope} AND n.nspname <> 'public'`,
      [SCHEMAS],
    );
    const schemas = [...new Set(schemaRows.map((r) => r.name))].map((name) => {
      const own = schemaRows.filter((r) => r.name === name);
      return {
        name,
        owner: own[0]?.owner ?? "",
        grants: own.flatMap((r) => (r.role === null ? [] : [{ role: r.role, privilege: r.privilege ?? "" }])),
      };
    });
    const defaults = await rows<State["defaults"][number]>(
      `SELECT d.defaclrole::regrole::text AS creator,
              CASE WHEN d.defaclnamespace = 0 THEN '*' ELSE d.defaclnamespace::regnamespace::text END AS schema,
              CASE d.defaclobjtype WHEN 'r' THEN 'tables' WHEN 'S' THEN 'sequences' WHEN 'f' THEN 'routines'
                   WHEN 'T' THEN 'types' WHEN 'n' THEN 'schemas' ELSE 'large objects' END AS kind,
              ${grantee("a.grantee")} AS role, a.privilege_type AS privilege
         FROM pg_catalog.pg_default_acl d, pg_catalog.aclexplode(d.defaclacl) a`,
    );
    const database = await rows<State["database"][number]>(
      `SELECT ${grantee("a.grantee")} AS role, a.privilege_type AS privilege
         FROM pg_catalog.pg_database d, pg_catalog.aclexplode(d.datacl) a
        WHERE d.datname = current_database() AND a.grantee <> d.datdba`,
    );
    const memberships = await rows<State["memberships"][number]>(
      `SELECT m.roleid::regrole::text AS role, m.member::regrole::text AS member FROM pg_catalog.pg_auth_members m`,
    );
    const roles = await rows<State["roles"][number]>(
      `SELECT r.rolname AS name, r.rolcanlogin AS login, r.rolconnlimit AS limit, r.oid = 10 AS bootstrap,
              r.rolsuper AS superuser,
              r.rolcreatedb AS createdb, r.rolcreaterole AS createrole, r.rolreplication AS replication,
              r.rolbypassrls AS bypassrls,
              coalesce((SELECT s.setconfig FROM pg_catalog.pg_db_role_setting s
                         WHERE s.setrole = r.oid AND s.setdatabase = 0), '{}') AS settings
         FROM pg_catalog.pg_roles r WHERE r.rolname !~ '^pg_'`,
    );
    const allSchemas = (await rows<{ name: string }>("SELECT nspname AS name FROM pg_catalog.pg_namespace")).map(
      (r) => r.name,
    );
    return {
      grants: [...relations, ...columns, ...routines],
      schemas,
      defaults,
      database,
      memberships,
      roles,
      allSchemas,
    };
  });
}

// ---- The diff ----

const TABLE_KINDS = new Set(["r", "p", "v", "m", "f"]);
const isColumnEntry = (e: TableEntry): e is ColumnEntry => !Array.isArray(e) && "columns" in e;

function tableLines(m: Matrix): string[] {
  return Object.entries(m.tables).flatMap(([object, roles]) =>
    Object.entries(roles).flatMap(([role, entry]) => {
      if (!isColumnEntry(entry))
        return (Array.isArray(entry) ? entry : entry.privileges).map((p) => `${role} ${p} ${object}`);
      const columns = Object.entries(entry.columns).flatMap(([column, privileges]) =>
        privileges.map((p) => `${role} ${p} ${object}.${column}`),
      );
      return [...columns, ...(entry.rowPrivileges ?? []).map((p) => `${role} ${p} ${object}`)];
    }),
  );
}

function schemaLines(m: Matrix): string[] {
  return Object.entries(m.schemas).flatMap(([schema, entry]) => [
    ...(entry.owner === undefined ? [] : [`schema ${schema} owned by ${entry.owner}`]),
    ...Object.entries(entry.grants ?? {}).flatMap(([role, ps]) => ps.map((p) => `${role} ${p} schema ${schema}`)),
    ...Object.entries(entry.defaults ?? {}).flatMap(([creator, kinds]) =>
      Object.entries(kinds).flatMap(([kind, roles]) =>
        Object.entries(roles).flatMap(([role, ps]) =>
          ps.map((p) => `default for ${creator} in ${schema}: ${role} ${p} ${kind}`),
        ),
      ),
    ),
  ]);
}

function roleLines(m: Matrix): string[] {
  return Object.entries(m.roles).flatMap(([role, entry]) => [
    ...entry.database.map((p) => `${role} ${p} database`),
    ...entry.memberOf.map((of) => `${role} member of ${of}`),
  ]);
}

/** The catalog as the same lines; memberships count for the roles the matrix lists. */
function actualLines(s: State, m: Matrix): string[] {
  const listed = new Set(Object.keys(m.roles));
  return [
    ...s.grants.map((g) => `${g.role} ${g.privilege} ${g.object}${g.column === null ? "" : `.${g.column}`}`),
    ...s.schemas.flatMap((schema) => [
      `schema ${schema.name} owned by ${schema.owner}`,
      ...schema.grants.map((g) => `${g.role} ${g.privilege} schema ${schema.name}`),
    ]),
    ...s.defaults.map((d) => `default for ${d.creator} in ${d.schema}: ${d.role} ${d.privilege} ${d.kind}`),
    ...s.database.map((d) => `${d.role} ${d.privilege} database`),
    ...s.memberships.filter((r) => listed.has(r.member)).map((r) => `${r.member} member of ${r.role}`),
  ];
}

/** `+ line` for what the catalog holds and the matrix does not, `- line` for the reverse, each sorted. */
export function diff(m: Matrix, s: State): string[] {
  const expected = new Set([...tableLines(m), ...schemaLines(m), ...roleLines(m)]);
  const actual = new Set(actualLines(s, m));
  return [
    ...[...actual]
      .filter((l) => !expected.has(l))
      .sort()
      .map((l) => `+ ${l}`),
    ...[...expected]
      .filter((l) => !actual.has(l))
      .sort()
      .map((l) => `- ${l}`),
  ];
}

// ---- Rules that hold whatever the matrix says ----

const hasRegistryRow = (table: string, rows: Record<string, unknown>): boolean =>
  Object.keys(rows).some((key) => key.startsWith(`${table}.`));

function entryViolations(table: string, role: string, entry: TableEntry, kind: string, personal: boolean): string[] {
  const out: string[] = [];
  if (Array.isArray(entry) && TABLE_KINDS.has(kind))
    out.push(`${table} ${role}: a table-level entry needs wholeTable: true`);
  if (personal && !isColumnEntry(entry)) out.push(`${table} ${role}: personal data is granted by column list`);
  if (isColumnEntry(entry) && (entry.rowPrivileges ?? []).some((p) => p !== "DELETE"))
    out.push(`${table} ${role}: DELETE is the only row privilege`);
  return out;
}

/** SE-6 and plan §5.2: a personal-data table (one with an erasure-registry row) is granted by column list only, with
 * DELETE the one row privilege; a table-level entry must say `wholeTable: true`, which a personal-data table refuses. */
export function matrixShapeViolations(m: Matrix, s: State, rows: Record<string, unknown>): string[] {
  const kinds = new Map(s.grants.map((g) => [g.object, g.kind]));
  const entries = Object.entries(m.tables).flatMap(([table, roles]) =>
    Object.entries(roles).flatMap(([role, entry]) =>
      entryViolations(table, role, entry, kinds.get(table) ?? "r", hasRegistryRow(table, rows)),
    ),
  );
  const granted = s.grants
    .filter((g) => g.column === null && g.privilege !== "DELETE" && hasRegistryRow(g.object, rows))
    .map((g) => `${g.object} ${g.role}: table-level ${g.privilege} on personal data`);
  return [...entries, ...granted];
}

/** No default privilege may ever reach a table in app or idx: every new table may carry a DID column. */
export function defaultTableViolations(s: State): string[] {
  return s.defaults
    .filter((d) => d.kind === "tables" && ["*", "app", "idx"].includes(d.schema) && d.role !== d.creator)
    .map((d) => `default ${d.privilege} on tables in ${d.schema} for ${d.role}`);
}

/** Members of `group`, directly or through other roles. */
function membersOf(group: string, s: State): Set<string> {
  const found = new Set<string>();
  const queue = [group];
  for (let role = queue.pop(); role !== undefined; role = queue.pop())
    for (const m of s.memberships.filter((x) => x.role === role && !found.has(x.member))) {
      found.add(m.member);
      queue.push(m.member);
    }
  return found;
}

const servicesAndJobs = (roster: readonly RosterRole[]) =>
  roster.filter((r) => r.class === "service" || r.class === "job").map((r) => r.name);

/** Service and job roles: memberships only as the matrix says, no TRUNCATE or TRIGGER, no CREATE anywhere. */
function serviceViolations(s: State, m: Matrix, roster: readonly RosterRole[]): string[] {
  return servicesAndJobs(roster).flatMap((role) => {
    const allowed = new Set(m.roles[role]?.memberOf ?? []);
    return [
      ...s.memberships
        .filter((x) => x.member === role && !allowed.has(x.role))
        .map((x) => `${role} is a member of ${x.role}`),
      ...s.grants
        .filter((g) => g.role === role && ["TRUNCATE", "TRIGGER"].includes(g.privilege))
        .map((g) => `${role} holds ${g.privilege} on ${g.object}`),
      ...s.database
        .filter((x) => x.role === role && x.privilege !== "CONNECT")
        .map((x) => `${role} holds ${x.privilege} on the database`),
      ...s.schemas.flatMap((schema) =>
        schema.grants
          .filter((x) => x.role === role && x.privilege !== "USAGE")
          .map((x) => `${role} holds ${x.privilege} on schema ${schema.name}`),
      ),
    ];
  });
}

/** api: nothing in app (plan §5.2). backup: SELECT on the matrix's tables only, never a transmission_buffer. auditor:
 * SELECT on the three audit tables and USAGE on audit only. */
function readerViolations(s: State, m: Matrix): string[] {
  const backupTables = new Set(Object.entries(m.tables).flatMap(([t, roles]) => ("backup" in roles ? [t] : [])));
  const schemaGrants = s.schemas.flatMap((schema) => schema.grants.map((g) => ({ ...g, schema: schema.name })));
  return [
    ...s.grants
      .filter((g) => g.role === "api" && g.object.startsWith("app."))
      .map((g) => `api holds ${g.privilege} on ${g.object}`),
    ...schemaGrants
      .filter((g) => g.role === "api" && g.schema === "app")
      .map((g) => `api holds ${g.privilege} on schema app`),
    ...s.grants
      .filter((g) => g.role === "backup" && (g.privilege !== "SELECT" || !backupTables.has(g.object)))
      .map((g) => `backup holds ${g.privilege} on ${g.object}`),
    ...s.grants
      .filter((g) => g.role === "backup" && g.object.split(".")[1] === "transmission_buffer")
      .map((g) => `backup reads ${g.object}`),
    ...s.grants
      .filter((g) => g.role === "auditor" && (g.privilege !== "SELECT" || !AUDITOR_TABLES.includes(g.object)))
      .map((g) => `auditor holds ${g.privilege} on ${g.object}`),
    ...schemaGrants
      .filter((g) => g.role === "auditor" && g.schema !== "audit")
      .map((g) => `auditor holds ${g.privilege} on schema ${g.schema}`),
  ];
}

/** The two roles nobody logs in as; legal_hold_reader's members are human roles only, however reached (lead decision
 * 2026-10-03). migrator holds ADMIN on it because it created it, and nothing more. */
function groupViolations(s: State, roster: readonly RosterRole[]): string[] {
  const humans = new Set(roster.filter((r) => r.class === "human").map((r) => r.name));
  return [
    ...["legal_hold_reader", "audit_owner"]
      .filter((name) => s.roles.find((r) => r.name === name)?.login !== false)
      .map((name) => `${name} can log in`),
    ...[...membersOf("legal_hold_reader", s)]
      .filter((member) => !humans.has(member) && member !== "migrator")
      .map((member) => `${member} is a member of legal_hold_reader`),
  ];
}

/** Step 6: the per-class assertions, independent of the matrix. */
export function classViolations(s: State, m: Matrix, roster: readonly RosterRole[]): string[] {
  return [
    ...serviceViolations(s, m, roster),
    ...readerViolations(s, m),
    ...groupViolations(s, roster),
    ...s.roles
      .filter((r) => !r.bootstrap && (r.superuser || r.replication || r.bypassrls))
      .map((r) => `${r.name} is superuser, replication or bypassrls`),
    ...s.grants
      .filter((g) => g.role === "PUBLIC" && /^(app|idx|audit)\./.test(g.object))
      .map((g) => `PUBLIC holds ${g.privilege} on ${g.object}`),
  ];
}

/** Decision 25: one schema plugin_<id>, one role of that name pinned to it, and no other service or job role on it. */
export function pluginViolations(s: State, m: Matrix, roster: readonly RosterRole[]): string[] {
  const others = new Set(servicesAndJobs(roster));
  return s.allSchemas
    .filter((name) => name.startsWith(m.pluginRule.schemaPrefix))
    .flatMap((schema) => {
      const role = s.roles.find((r) => r.name === schema);
      if (role === undefined) return [`${schema} has no role of its own`];
      const onSchema = [
        ...s.grants.filter((g) => g.object.startsWith(`${schema}.`)).map((g) => g.role),
        ...(s.schemas.find((x) => x.name === schema)?.grants.map((g) => g.role) ?? []),
      ];
      return [
        ...(role.settings.includes(`search_path=${schema}`) ? [] : [`${schema} role's search_path is not its schema`]),
        ...s.grants
          .filter((g) => g.role === schema && !g.object.startsWith(`${schema}.`))
          .map((g) => `${schema} holds ${g.privilege} on ${g.object}`),
        ...s.schemas
          .filter((x) => x.name !== schema)
          .flatMap((x) =>
            x.grants.filter((g) => g.role === schema).map((g) => `${schema} holds ${g.privilege} on schema ${x.name}`),
          ),
        ...[...new Set(onSchema)].filter((r) => others.has(r)).map((r) => `${r} holds a privilege on ${schema}`),
      ];
    });
}
