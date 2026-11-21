// The unset.cc edge lets through exactly the door's browser routes (review finding N1; ADR 0088 decision 1, ADR 0094).
// The edge's door pattern (deployment/edge/adapted-rules.ts CHAT_DOOR_PATH, the same text in dev/chat.caddy's @door)
// and the door's route tables (interfaces/chat-auth/door.ts GET_ROUTES and POST_PATHS, which compose.ts wires) are
// written by hand in two places; this test holds them to one list, so a door route the browser visits never answers
// the edge's 404 and the edge never forwards a path the door does not serve.
//
// How each route is called, read from its caller:
// - the page's document at /, /sign-in/return (web's hop, interfaces/web chat-sign-in.ts), /welcome (signup's chat
//   step), /sign-out/return (web's Log out, chat-sign-out.ts) and /dm/<did> (a profile's Message link), its files under
//   /assets/, and the top-level navigations /sign-in, /welcome/done and /sign-out/done: the browser;
// - every POST route: the chat page's own same-origin fetches (apps/chat/core/*.ts, matrix/client.ts), /chat-id
//   included (apps/chat/core/contact.ts);
// - /health: the door's container check only, never the browser, so it has no edge path.
// web's server-to-server reads, GET /count and GET /set-up, are on the door's count listener (count.ts), a separate
// handler on an internal network the edge never joins, so they are not in these tables at all.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CHAT_DOOR_PATH } from "../../../deployment/edge/adapted-rules.ts";
import { DM_PREFIX, GET_ROUTES, POST_PATHS } from "../../../interfaces/chat-auth/door.ts";
import { ASSETS } from "../../../interfaces/chat-auth/page.ts";

const ROOT = join(import.meta.dirname, "../../..");
/** Door routes only a server calls: no edge path on purpose. */
const SERVER_ONLY = ["/health"];
/** The door's pattern routes, each with a path the browser really asks for. */
const PATTERN_ROUTES: Readonly<Record<string, { prefix: string; sample: string }>> = {
  [ASSETS]: { prefix: ASSETS, sample: `${ASSETS}index-AbC_12.js` },
  [`${DM_PREFIX}*`]: { prefix: DM_PREFIX, sample: `${DM_PREFIX}did:plc:abcdefghijklmnopqrstuvwx` },
};

type Expansion = { literals: string[]; prefixes: string[] };

/** The top-level alternatives of `body`, split only at a `|` outside every group and class. */
function alternatives(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inClass = false;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") i++;
    else if (inClass) inClass = c !== "]";
    else if (c === "[") inClass = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "|" && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out;
}

/**
 * The paths one alternative matches: every literal it spells, expanding `(?:a|b)` and `(?:…)?` groups, and, where it
 * reaches a character class or escape, the literal prefix before it (a pattern route). This is the small subset of
 * RE2 the edge's pattern uses; anything else fails the test rather than being guessed at.
 */
function expand(alt: string): Expansion {
  let heads = [""];
  let i = 0;
  while (i < alt.length) {
    const c = alt[i] as string;
    if (c === "[" || c === "\\") return { literals: [], prefixes: heads };
    if (c === "(") {
      const group = readGroup(alt, i);
      heads = heads.flatMap((h) => [...(group.optional ? [h] : []), ...group.parts.map((part) => h + part)]);
      i = group.end;
    } else {
      expect(c).toMatch(/^[\w/:-]$/);
      heads = heads.map((h) => h + c);
      i++;
    }
  }
  return { literals: heads, prefixes: [] };
}

/** A flat `(?:a|b)` group of literals at `start`, optional when `?` follows it; a nested group fails the check. */
function readGroup(alt: string, start: number): { parts: string[]; optional: boolean; end: number } {
  expect(alt.startsWith("(?:", start)).toBe(true);
  const close = alt.indexOf(")", start);
  const parts = alt.slice(start + 3, close).split("|");
  for (const part of parts) expect(part).toMatch(/^[\w/:.-]*$/);
  const optional = alt[close + 1] === "?";
  return { parts, optional, end: close + 1 + (optional ? 1 : 0) };
}

/** Every path the edge's door pattern lets through: `^/(?:alt|alt|…)?$`. */
function edgePaths(pattern: string): Expansion {
  const shape = /^\^\/\(\?:(.*)\)\?\$$/.exec(pattern);
  expect(shape).not.toBeNull();
  const all = alternatives(shape?.[1] ?? "").map(expand);
  return {
    literals: ["/", ...all.flatMap((e) => e.literals.map((p) => `/${p}`))].sort(),
    prefixes: all.flatMap((e) => e.prefixes.map((p) => `/${p}`)).sort(),
  };
}

describe("the unset.cc edge and the door", () => {
  const edge = edgePaths(CHAT_DOOR_PATH);
  const pattern = new RegExp(CHAT_DOOR_PATH);
  const literalRoutes = [...GET_ROUTES, ...POST_PATHS].filter((r) => !(r in PATTERN_ROUTES)).sort();
  const browserLiterals = literalRoutes.filter((r) => !SERVER_ONLY.includes(r));

  test("edge.chat_caddy_door_is_the_rule: dev/chat.caddy's @door matcher is CHAT_DOOR_PATH, character for character", () => {
    const caddy = readFileSync(join(ROOT, "deployment/edge/dev/chat.caddy"), "utf8");
    const doors = [...caddy.matchAll(/@door vars_regexp \{http\.request\.uri\.path\} (\S+)/g)].map((m) => m[1]);
    expect(doors).toEqual([CHAT_DOOR_PATH]);
  });

  test("edge.door_routes_match: every door route the browser visits has an edge path, and every edge path a route", () => {
    // Literal routes, both ways.
    expect(edge.literals).toEqual(browserLiterals);
    // Pattern routes: each door pattern has an edge pattern inside it, and each edge pattern lies under a door pattern.
    const doorPrefixes = Object.values(PATTERN_ROUTES).map((p) => p.prefix);
    for (const prefix of doorPrefixes) expect(edge.prefixes.some((p) => p.startsWith(prefix))).toBe(true);
    for (const prefix of edge.prefixes) expect(doorPrefixes.some((p) => prefix.startsWith(p))).toBe(true);
    // And every route really passes the edge's pattern, the patterns by a path the page asks for.
    for (const route of browserLiterals) expect(pattern.test(route), route).toBe(true);
    for (const { sample } of Object.values(PATTERN_ROUTES)) expect(pattern.test(sample), sample).toBe(true);
  });

  test("edge.server_only_routes_stay_off: a route only servers call has no edge path", () => {
    for (const route of SERVER_ONLY) {
      expect(literalRoutes).toContain(route);
      expect(pattern.test(route), route).toBe(false);
    }
  });

  test("edge.door_pattern_routes_known: the door's pattern routes are exactly the two this test samples", () => {
    expect(
      [...GET_ROUTES, ...POST_PATHS].filter((r) => r !== "/" && (r.endsWith("/") || r.endsWith("*"))).sort(),
    ).toEqual(Object.keys(PATTERN_ROUTES).sort());
  });
});
