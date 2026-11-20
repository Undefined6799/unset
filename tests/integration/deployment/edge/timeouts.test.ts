// The deadline-order check's own failures (P1.28 edge_timeout_above_every_deadline): a route deadline at the edge's
// limit, a site without the upstream snippet's timeout, a server whose write clock cannot cover a whole upload and the
// upstream's wait after it (ADR 0076), or no manifest at all each fail.
import { describe, expect, test } from "vitest";
import { timeoutProblems } from "./timeouts.ts";

const S = 1_000_000_000;
const proxy = (header?: number) => ({
  handler: "reverse_proxy",
  ...(header === undefined ? {} : { transport: { protocol: "http", response_header_timeout: header } }),
});
const config = (...handlers: object[]) => ({
  apps: {
    http: { servers: { srv0: { read_timeout: 120 * S, write_timeout: 255 * S, routes: [{ handle: handlers }] } } },
  },
});
const limits = { EDGE_UPSTREAM_TIMEOUT_S: 130, EDGE_READ_BODY_S: 120 };
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

  // A picture upload (routes/images/policy.ts): its body may take the read window, and its deadline runs after it.
  test("body_window_beyond_the_read_window_fails", () => {
    const upload = (bodyWindowMs: number) => [
      { file: "f.json", routes: [{ path: "/images", bodyWindowMs, deadlineMs: 100_000 }] },
    ];
    expect(timeoutProblems(config(proxy(130 * S)), limits, upload(120_000), 60_000)).toEqual([]);
    expect(timeoutProblems(config(proxy(130 * S)), limits, upload(121_000), 60_000)).toEqual([
      "f.json /images: bodyWindowMs 121000",
    ]);
  });

  test("site_without_the_snippet_fails", () => {
    expect(timeoutProblems(config(proxy(130 * S), proxy()), limits, manifests, 60_000)).toEqual([
      "a reverse_proxy has response_header_timeout unset",
    ]);
  });

  test("write_timeout_and_inputs_checked", () => {
    const server = (read: number, write: number) => ({
      apps: { http: { servers: { srv0: { read_timeout: read, write_timeout: write, routes: [proxy(130 * S)] } } } },
    });
    // Go's write clock starts when the headers are read (net/http Server.WriteTimeout), so the body counts against it.
    expect(timeoutProblems(server(120 * S, 250 * S), limits, manifests, 60_000)).toEqual([
      "server srv0 write timeout is not above its read window and the upstream's",
    ]);
    expect(timeoutProblems(server(30 * S, 255 * S), limits, manifests, 60_000)).toEqual([
      "server srv0 read_timeout 30000000000 is not limits.json EDGE_READ_BODY_S",
    ]);
    expect(timeoutProblems(config(proxy(130 * S)), { EDGE_UPSTREAM_TIMEOUT_S: 130 }, manifests, 60_000)).toEqual([
      "limits.json has no EDGE_READ_BODY_S",
    ]);
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
