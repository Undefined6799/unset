// The deadline-order check's own failures (P1.28 edge_timeout_above_every_deadline): a route deadline at the edge's
// limit, a site without the upstream snippet's timeout, or no manifest at all each fail.
import { describe, expect, test } from "vitest";
import { timeoutProblems } from "./timeouts.ts";

const S = 1_000_000_000;
const proxy = (header?: number) => ({
  handler: "reverse_proxy",
  ...(header === undefined ? {} : { transport: { protocol: "http", response_header_timeout: header } }),
});
const config = (...handlers: object[]) => ({
  apps: { http: { servers: { srv0: { write_timeout: 135 * S, routes: [{ handle: handlers }] } } } },
});
const limits = { EDGE_UPSTREAM_TIMEOUT_S: 130 };
const manifests = [
  { file: "interfaces/http/routes.manifest.json", routes: [{ path: "/publish", deadlineMs: 120_000 }] },
];

describe("edge deadline order", () => {
  test("holds_for_the_shipped_shape", () => {
    expect(timeoutProblems(config(proxy(130 * S)), limits, manifests, 60_000)).toEqual([]);
  });

  test("route_deadline_at_the_edge_limit_fails", () => {
    const late = [{ file: "f.json", routes: [{ path: "/slow", deadlineMs: 130_000 }] }];
    expect(timeoutProblems(config(proxy(130 * S)), limits, late, 60_000)).toEqual(["f.json /slow: deadlineMs 130000"]);
  });

  test("site_without_the_snippet_fails", () => {
    expect(timeoutProblems(config(proxy(130 * S), proxy()), limits, manifests, 60_000)).toEqual([
      "a reverse_proxy has response_header_timeout unset",
    ]);
  });

  test("write_timeout_and_inputs_checked", () => {
    const short = { apps: { http: { servers: { srv0: { write_timeout: 130 * S, routes: [proxy(130 * S)] } } } } };
    expect(timeoutProblems(short, limits, manifests, 60_000)).toEqual(["server srv0 write timeout is not above it"]);
    expect(timeoutProblems(config(proxy(130 * S)), limits, [], 60_000)).toEqual(["no route manifest was read"]);
    expect(timeoutProblems(config(proxy(130 * S)), {}, manifests, 60_000)).toEqual([
      "limits.json has no EDGE_UPSTREAM_TIMEOUT_S",
    ]);
    expect(timeoutProblems(config(), limits, manifests, 130_000)).toEqual([
      "no reverse_proxy in the config",
      "REQUEST_DEADLINE_MS max 130000",
    ]);
  });
});
