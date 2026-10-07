// P1.28: the edge in front of the PDS (step book P1.28, algorithm and "Done when"). The image is built from
// deployment/edge and run with the shipped config; only the ACME issuer is swapped for Caddy's internal CA. A stub
// upstream records what got through.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildEdgeImage, docker, EDGE, type Edge, type ProbeStep, startEdge } from "./edge-container.ts";
import { timeoutProblems } from "./timeouts.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..", "..");
const ADMIN_NSIDS = [
  "com.atproto.admin.getAccountInfo",
  "com.atproto.temp.checkSignupQueue",
  "com.atproto.server.createInviteCode",
  "com.atproto.server.createInviteCodes",
  "tools.ozone.moderation.queryEvents",
];
const cases = (nsid: string) => [
  nsid,
  nsid.toUpperCase(),
  nsid.replace(/[a-z]/g, (c, i) => (i % 2 ? c.toUpperCase() : c)),
];
const ROUTE_CLASS = /^(?:xrpc:[A-Za-z0-9.-]+|xrpc:_health|oauth|well-known|health|other)$/;

let edge: Edge;
let image: string;
const sentPaths: string[] = [];

/** Sends from the test process and remembers the path, so the log test can look for it. */
const send = (path: string, headers?: Record<string, string>) => {
  sentPaths.push(path);
  return edge.send(path, headers);
};
/** Probes from a loopback address inside the edge's namespace, remembering the paths as `send` does. */
const probe = (source: string, steps: readonly ProbeStep[]) => {
  for (const step of steps) if (step.kind === "https") sentPaths.push(...Array(step.count ?? 1).fill(step.path));
  return edge.probe(source, steps);
};
/** Sends one more than `limit` requests to `path` from `source`: all pass but the last, which gets 429. */
async function expectZone(source: string, path: string, zone: string, method = "GET"): Promise<void> {
  const limit = ZONES[zone];
  if (limit === undefined) throw new Error(`no zone ${zone} in limits.json`);
  const [result] = await probe(source, [{ kind: "https", path, method, count: limit + 1 }]);
  const statuses = result?.statuses ?? [];
  expect(statuses.slice(0, limit).filter((status) => status !== 200)).toEqual([]);
  expect(statuses[limit]).toBe(429);
  expect(Number(result?.retryAfter)).toBeGreaterThan(0);
}

/** Each zone's limit, from deployment/edge/limits.json. */
const ZONES = Object.fromEntries(
  Object.entries(
    (
      JSON.parse(readFileSync(join(EDGE, "limits.json"), "utf8")) as {
        rateLimitZones: Record<string, { events: number }>;
      }
    ).rateLimitZones,
  ).map(([name, zone]) => [name, zone.events]),
) as Record<string, number>;
const FORWARDED = ["x-forwarded-for", "x-real-ip", "forwarded"];

/** True when the stub saw a request for exactly this raw path since `from`. */
const reached = (path: string, from: number) => edge.seen.slice(from).some((seen) => seen.rawPath === path);

beforeAll(async () => {
  image = buildEdgeImage();
  edge = await startEdge(image);
}, 600_000);
afterAll(async () => {
  await edge?.stop();
});

describe("edge", () => {
  test("edge_allows_normal_xrpc", async () => {
    const from = edge.seen.length;
    const path = "/xrpc/com.atproto.server.describeServer";
    expect((await send(path)).status).toBe(200);
    expect(reached(path, from)).toBe(true);
  });

  test("edge_allows_lexicon_resolution_routes", async () => {
    for (const path of [
      "/xrpc/com.atproto.sync.getRecord?did=did:plc:abc&collection=app.bsky.feed.post&rkey=1",
      "/xrpc/com.atproto.repo.getRecord?repo=did:plc:abc&collection=app.bsky.feed.post&rkey=1",
      "/xrpc/com.atproto.repo.describeRepo?repo=did:plc:abc",
      "/xrpc/com.atproto.identity.resolveHandle?handle=alice.test",
      "/xrpc/_health",
    ]) {
      const from = edge.seen.length;
      expect((await send(path)).status, path).toBe(200);
      expect(reached(path, from), path).toBe(true);
    }
  });

  test("edge_denies_admin_all_case", async () => {
    for (const nsid of ADMIN_NSIDS.flatMap(cases)) {
      const from = edge.seen.length;
      expect((await send(`/xrpc/${nsid}`)).status, nsid).toBe(404);
      expect(edge.seen.length, nsid).toBe(from);
    }
  });

  test("edge_denies_encoded_paths", async () => {
    for (const path of [
      "/xrpc/com%2eatproto%2eadmin.getAccountInfo",
      "/xrpc/com.atproto%2Eadmin.getAccountInfo",
      "/xrpc/%2e%2e/xrpc/com.atproto.admin.getAccountInfo",
      "/xrpc/com.atproto.admin%2fgetAccountInfo",
      "/xrpc/com%252eatproto%252eadmin.getAccountInfo",
      "/xrpc/com.atproto.server.describeServer/",
      "/xrpc/com.atproto.server.describeServer/extra",
      "/%78rpc/com.atproto.admin.getAccountInfo",
      "/XRPC/com.atproto.admin.getAccountInfo",
      "//xrpc/com.atproto.admin.getAccountInfo",
      "/a/../xrpc/com.atproto.admin.getAccountInfo",
    ]) {
      const from = edge.seen.length;
      expect((await send(path)).status, path).toBe(400);
      expect(edge.seen.length, path).toBe(from);
    }
  });

  test("edge_denies_basic_auth", async () => {
    const from = edge.seen.length;
    const basic = `Basic ${Buffer.from("admin:secret").toString("base64")}`;
    for (const authorization of [basic, basic.toLowerCase(), ` ${basic}`]) {
      const response = await send("/xrpc/com.atproto.server.describeServer", { authorization });
      expect(response.status, authorization).toBe(401);
      expect(response.headers["www-authenticate"]).toBeUndefined();
    }
    expect(edge.seen.length).toBe(from);
  });

  test("edge_strips_client_address_headers", async () => {
    const from = edge.seen.length;
    const path = "/xrpc/com.atproto.server.describeServer?strip";
    await send(path, { "x-forwarded-for": "192.0.2.10", "x-real-ip": "192.0.2.10", forwarded: "for=192.0.2.10" });
    const seen = edge.seen.slice(from).find((s) => s.rawPath === path);
    expect(seen).toBeDefined();
    for (const header of ["x-forwarded-for", "x-real-ip", "forwarded"]) {
      expect(seen?.headers[header], header).toBeUndefined();
    }
    expect(seen?.headers["x-forwarded-proto"]).toBe("https");
  });

  test("pds_route_strips_forwarded_headers", async () => {
    // Caddy sets X-Forwarded-For by default and the PDS trusts private-network peers, so neither the default nor a
    // client-sent value, in any letter case, may reach it.
    const from = edge.seen.length;
    await send("/xrpc/com.atproto.server.describeServer?default");
    await send("/xrpc/com.atproto.server.describeServer?cased", {
      "X-Forwarded-For": "192.0.2.10, 192.0.2.20",
      "X-REAL-IP": "192.0.2.10",
      FORWARDED: "for=192.0.2.10;proto=http",
    });
    const seen = edge.seen.slice(from);
    expect(seen.length).toBe(2);
    for (const request of seen) {
      for (const header of FORWARDED) expect(request.headers[header], `${request.rawPath} ${header}`).toBeUndefined();
    }
  });

  test("edge_security_headers", async () => {
    const response = await send("/xrpc/com.atproto.server.describeServer?headers");
    expect(response.headers["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers.server).toBeUndefined();
    expect(response.headers.via).toBeUndefined();
  });

  test("edge_admin_api_off", () => {
    expect(edge.exec(["wget", "-q", "-T", "2", "-O", "-", "http://127.0.0.1:2019/config/"]).code).not.toBe(0);
    expect(edge.exec(["wget", "-q", "-T", "2", "-O", "-", "http://localhost:2019/config/"]).code).not.toBe(0);
  });

  test("edge_image_plugins_exact", () => {
    const modules = docker(["run", "--rm", "--entrypoint", "caddy", image, "list-modules", "--skip-standard"]);
    expect(modules.code).toBe(0);
    expect(modules.out.split("\n").filter((line) => /^\S+\.\S+$/.test(line.trim()))).toEqual([
      "http.handlers.rate_limit",
    ]);
  });

  test("edge_caddyfile_validates", () => {
    // The built image with its own files (production tls.caddy included) and the PDS site enabled.
    const validate = docker([
      ...["run", "--rm", "--read-only", "--entrypoint", "caddy"],
      ...["-e", "ACME_EMAIL=edge@unset.test", "-e", "PDS_HOST=pds.unset.test", "-e", "PDS_UPSTREAM=127.0.0.1:9"],
      ...["-v", `${join(EDGE, "sites", "pds.caddy")}:/etc/caddy/sites/enabled/pds.caddy:ro`],
      ...[image, "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"],
    ]);
    expect(validate.code, validate.err).toBe(0);
    expect(validate.out).toContain("Valid configuration");
  });

  test("edge_timeout_above_every_deadline", () => {
    const adapted = edge.exec(["caddy", "adapt", "--config", "/etc/caddy/Caddyfile"]);
    expect(adapted.code, adapted.out).toBe(0);
    const config = JSON.parse(adapted.out.slice(adapted.out.indexOf("{")));
    const limits = JSON.parse(readFileSync(join(EDGE, "limits.json"), "utf8"));
    const manifests = readdirSync(join(REPOSITORY, "interfaces"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(REPOSITORY, "interfaces", entry.name, "routes.manifest.json"))
      .filter((file) => {
        try {
          readFileSync(file);
          return true;
        } catch {
          return false;
        }
      })
      .map((file) => ({ file, routes: JSON.parse(readFileSync(file, "utf8")) }));
    expect(manifests.map((m) => m.file)).toContain(join(REPOSITORY, "interfaces", "http", "routes.manifest.json"));
    const configTs = readFileSync(join(REPOSITORY, "shared", "http", "config.ts"), "utf8");
    const maxDeadline = Number(
      /REQUEST_DEADLINE_MS: int\(\{[^}]*max: ([\d_]+)/.exec(configTs)?.[1]?.replaceAll("_", ""),
    );
    expect(maxDeadline).toBe(60_000);
    expect(timeoutProblems(config, limits, manifests, maxDeadline)).toEqual([]);
  });

  test("edge_all_logs_have_no_ip_path_or_query", async () => {
    const canary = `c${Date.now().toString(36)}q`;
    for (const path of [
      `/join?code=${canary}`,
      `/@${canary}-handle.test`,
      `/o/draft-preview/drafts/did:plc:${canary}/x`,
    ]) {
      await send(path);
    }
    await edge.garbage("\u0016\u0003\u0001 not a tls hello\r\n\r\n");
    await edge.malformed();
    const { stdout, stderr } = edge.logs();
    const all = `${stdout}\n${stderr}`;
    expect(all).not.toContain(canary);
    expect(all).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
    expect(all).not.toMatch(/\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\]?:\d+/i);
    expect(all).not.toMatch(/"(?:headers|resp_headers|uri|remote_ip|remote_port|client_ip|remote_addr)"/);
    expect(all).not.toContain("?");
    for (const path of new Set(sentPaths)) expect(all, path).not.toContain(path.split("?")[0]);
  });

  test("edge_access_log_route_class", () => {
    const lines = edge
      .logs()
      .stdout.split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { request?: Record<string, unknown>; route_class?: string });
    expect(lines.length).toBe(sentPaths.length);
    for (const line of lines) {
      expect(line.route_class, JSON.stringify(line)).toMatch(ROUTE_CLASS);
      expect(Object.keys(line.request ?? {}).sort()).toEqual(["host", "method"]);
    }
    const classes = lines.map((line) => line.route_class);
    expect(classes).toContain("xrpc:com.atproto.server.describeServer");
    expect(classes).toContain("other");
  });

  test("edge_logs_no_client_address", async () => {
    const spoofed = { "x-forwarded-for": "203.0.113.9" };
    const [, , , adminApi, health] = await probe("127.0.0.2", [
      { kind: "https", path: "/xrpc/com.atproto.server.createSession", count: 31, headers: spoofed },
      { kind: "https", path: "/xrpc/com.atproto.server.describeServer", headers: { ...spoofed, "x-stub-fail": "1" } },
      { kind: "garbage" },
      { kind: "http", port: 2019, path: "/metrics" },
      { kind: "http", port: 8081, path: "/metrics" },
    ]);
    // No metrics endpoint answers: the admin API is off and the health site serves /health only.
    expect(adminApi?.statuses).toEqual([-1]);
    expect(health?.statuses).toEqual([404]);
    const { stdout, stderr } = edge.logs();
    expect(stderr).toContain('"status":502');
    expect(stdout).toContain('"status":429');
    for (const address of ["127.0.0.2", "203.0.113.9"]) expect(`${stdout}\n${stderr}`).not.toContain(address);
  });

  // One test per zone (architecture's values, limits.json): from its own loopback address, every request below the
  // limit passes and the next one gets 429 with Retry-After (the guard against caddy-ratelimit #94). The long-window
  // twins (session_day, firehose_hour) share their matcher with the short zone, checked in deployment/edge.
  test("edge_rate_limit_auth_zone", async () => {
    const signIn = "/@atproto/oauth-provider/~api/sign-in";
    await expectZone("127.0.0.6", signIn, "oauth_signin", "POST");
    // Another client address has its own bucket.
    const [other] = await probe("127.0.0.7", [{ kind: "https", path: signIn, method: "POST" }]);
    expect(other?.statuses).toEqual([200]);
  });

  test("edge_session_zone", async () => {
    await expectZone("127.0.0.8", "/xrpc/com.atproto.server.createSession", "session", "POST");
  });

  test("edge_oauth_token_zone", async () => {
    await expectZone("127.0.0.9", "/oauth/token", "oauth_token", "POST");
  });

  test("edge_signup_zone", async () => {
    await expectZone("127.0.0.10", "/xrpc/com.atproto.server.createAccount", "signup", "POST");
  });

  test("edge_reset_zone", async () => {
    await expectZone("127.0.0.11", "/xrpc/com.atproto.server.requestPasswordReset", "reset", "POST");
  });

  test("edge_sync_zone", async () => {
    await expectZone("127.0.0.3", "/xrpc/com.atproto.sync.getLatestCommit?did=did:plc:abc", "sync");
  });

  test("edge_blob_read_zone", async () => {
    await expectZone("127.0.0.12", "/xrpc/com.atproto.sync.getBlob?did=did:plc:abc&cid=bafyabc", "blob_read");
  });

  test("edge_blob_upload_zone", async () => {
    await expectZone("127.0.0.13", "/xrpc/com.atproto.repo.uploadBlob", "blob_upload", "POST");
  });

  test("edge_firehose_zone", async () => {
    await expectZone("127.0.0.4", "/xrpc/com.atproto.sync.subscribeRepos", "firehose");
  });

  test("edge_identity_zone", async () => {
    await expectZone("127.0.0.5", "/xrpc/com.atproto.identity.resolveHandle?handle=alice.test", "identity");
  });

  test("edge_global_zone", async () => {
    await expectZone("127.0.0.14", "/xrpc/com.atproto.repo.describeRepo?repo=did:plc:abc", "global");
  });
});
