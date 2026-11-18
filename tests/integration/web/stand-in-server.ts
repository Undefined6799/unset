// The built web server with stand-ins for the network it may not reach in a test (rule TE-1: unmanaged dependencies
// only): PLC, DNS and handle domains, and the requests the OAuth client and the PDS calls make. It sets them where
// server.ts reads them (interfaces/web/src/lib/server/note.ts `StandIns`), then starts server.ts as production does.
// compose.ts refuses stand-ins outside the test profile. Answers come from the JSON file WEB_STAND_IN_FIXTURE names,
// written by the test (built-server.ts `StandInFixture`); anything not in it is a 404 or no record.
import { readFileSync } from "node:fs";
import type { IdentityNetwork } from "@unset/domains-identity";
import type { StandInFixture } from "./built-server.ts";

const fixture = JSON.parse(readFileSync(process.env.WEB_STAND_IN_FIXTURE ?? "", "utf8")) as StandInFixture;
const encode = (body: unknown): Uint8Array =>
  new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body));

const network: IdentityNetwork = {
  get: async (url) => {
    const found = fixture.http?.[url.href];
    return found === undefined
      ? { kind: "response", status: 404, body: new Uint8Array() }
      : { kind: "response", status: found.status ?? 200, body: encode(found.body) };
  },
  txt: async (name) => {
    const records = fixture.txt?.[name];
    return records === undefined ? { kind: "no_record" } : { kind: "records", records };
  },
};

/** Every request the OAuth client makes: the fixture's answer for its method and URL, else 404. */
const fetchStandIn: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const found = fixture.fetch?.[`${request.method} ${request.url}`];
  if (found === undefined) return new Response("not in the fixture", { status: 404 });
  return new Response(JSON.stringify(found.body), {
    status: found.status ?? 200,
    headers: { "content-type": "application/json" },
  });
};

(globalThis as Record<symbol, unknown>)[Symbol.for("unset.web.stand-ins")] = { network, fetch: fetchStandIn };
// By URL, so the type checker does not pull the web process into the tests project.
await import(new URL("../../../interfaces/web/server.ts", import.meta.url).href);
