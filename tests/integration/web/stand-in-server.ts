// The built web server with stand-ins for the network it may not reach in a test (rule TE-1: unmanaged dependencies
// only): PLC, DNS and handle domains, and the requests the OAuth client and the PDS calls make. It sets them where
// server.ts reads them (interfaces/web/src/lib/server/note.ts `StandIns`), then starts server.ts as production does.
// compose.ts refuses stand-ins outside the test profile. Answers come from the JSON file WEB_STAND_IN_FIXTURE names,
// written by the test (built-server.ts `StandInFixture`) and read again on every request, so a test can change an
// answer; anything not in it is a 404 or no record. Each fetch is appended to the file WEB_STAND_IN_CALLS names. The
// stand-in PDS (`pds`) keeps its own state, so it is built once from the fixture the server started with.
import { appendFileSync, readFileSync } from "node:fs";
import type { IdentityNetwork } from "@unset/domains-identity";
import type { StandInFixture } from "./built-server.ts";
import { standInPds } from "./stand-in-pds.ts";

const fixture = (): StandInFixture =>
  JSON.parse(readFileSync(process.env.WEB_STAND_IN_FIXTURE ?? "", "utf8")) as StandInFixture;
const encode = (body: unknown): Uint8Array =>
  new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body));

const network: IdentityNetwork = {
  get: async (url) => {
    const found = fixture().http?.[url.href];
    return found === undefined
      ? { kind: "response", status: 404, body: new Uint8Array() }
      : { kind: "response", status: found.status ?? 200, body: encode(found.body) };
  },
  txt: async (name) => {
    const records = fixture().txt?.[name];
    return records === undefined ? { kind: "no_record" } : { kind: "records", records };
  },
};

const started = fixture().pds;
const pds =
  started === undefined
    ? undefined
    : standInPds(started, (write) => appendFileSync(started.writesFile, `${JSON.stringify(write)}\n`));
/** Every request the OAuth client and the PDS calls make: the stand-in PDS, else the fixture's answer, else 404. */
const fetchStandIn: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const key = `${request.method} ${request.url}`;
  appendFileSync(process.env.WEB_STAND_IN_CALLS ?? "", `${key}\n`);
  const fromPds = pds === undefined ? undefined : await pds(request);
  if (fromPds !== undefined) return fromPds;
  const found = fixture().fetch?.[key];
  if (found === undefined) return new Response("not in the fixture", { status: 404 });
  return new Response(JSON.stringify(found.body), {
    status: found.status ?? 200,
    headers: { "content-type": "application/json" },
  });
};

(globalThis as Record<symbol, unknown>)[Symbol.for("unset.web.stand-ins")] = { network, fetch: fetchStandIn };
// By URL, so the type checker does not pull the web process into the tests project.
await import(new URL("../../../interfaces/web/server.ts", import.meta.url).href);
