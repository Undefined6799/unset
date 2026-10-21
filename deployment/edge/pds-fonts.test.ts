// P2.24e: bounded PDS font policy and authoritative packaging provenance.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readCaddyfile } from "./caddyfile.ts";

const EDGE = import.meta.dirname;
const read = (file: string) => readFileSync(join(EDGE, file), "utf8");
const env = { PDS_HOST: "pds.unset.test", PDS_UPSTREAM: "pds:3000", ACME_EMAIL: "edge@unset.test" };
const snippets = () =>
  readdirSync(join(EDGE, "snippets"))
    .sort()
    .map((name) => read(`snippets/${name}`))
    .join("\n");

test("proxy options retain all generic forwarding and timeout protections", () => {
  const config = readCaddyfile(
    `${snippets()}\n{$PDS_HOST} {\nroute {\nreverse_proxy {$PDS_UPSTREAM} {\nimport proxy-options\n}\n}\n}`,
    env,
  );
  expect((config.sites[0]?.directives[0]?.block?.[0]?.block ?? []).map((d) => [d.name, d.args])).toEqual([
    ["header_up", ["-X-Forwarded-For"]],
    ["header_up", ["-X-Real-IP"]],
    ["header_up", ["-Forwarded"]],
    ["header_up", ["X-Forwarded-Proto", "https"]],
    ["header_up", ["X-Forwarded-Host", "{host}"]],
    ["transport", ["http"]],
  ]);
  const proxy = config.snippet("upstream", ["pds:3000"])[0];
  expect(proxy?.block?.map(({ via: _via, ...d }) => d)).toEqual(
    (config.sites[0]?.directives[0]?.block?.[0]?.block ?? []).map(({ via: _via, ...d }) => d),
  );
});
