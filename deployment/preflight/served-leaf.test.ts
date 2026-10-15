// P1.34d item 15: the check `local:up` runs after start, against a real TLS server on a loopback port standing in for
// the edge, with throwaway certificates from the openssl on this machine. Nothing here starts Docker.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { type AddressInfo, createServer as createTcpServer, type Server as TcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConnectionOptions, connect, createSecureContext, createServer, type Server } from "node:tls";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type Connect, leafEnv, servedLeafProblem } from "./served-leaf.ts";

const HOSTS = ["app.localhost", "pds.localhost"];
const SAN = HOSTS.map((host) => `DNS:${host}`).join(",");

describe("the served leaf check (P1.34d item 15)", () => {
  let dir = "";
  const pem = (name: string) => readFileSync(join(dir, `${name}.pem`), "utf8");
  const key = (name: string) => readFileSync(join(dir, `${name}.key`), "utf8");
  /** A P-256 certificate: self-signed when `issuer` is absent, else signed by it. */
  const make = (name: string, extensions: string[], issuer?: string) =>
    execFileSync(
      "openssl",
      [
        ...["req", "-x509", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes"],
        ...["-keyout", `${name}.key`, "-out", `${name}.pem`, "-days", "30", "-subj", `/CN=${name}`],
        ...(issuer === undefined ? [] : ["-CA", `${issuer}.pem`, "-CAkey", `${issuer}.key`]),
        ...extensions.flatMap((extension) => ["-addext", extension]),
      ],
      { cwd: dir, stdio: "ignore" },
    );
  const LEAF = ["basicConstraints=critical,CA:FALSE", `subjectAltName=${SAN}`, "extendedKeyUsage=serverAuth"];

  const servers: Server[] = [];
  /** Listens on a free loopback port and serves `byHost[servername]`, else `fallback`; resolves to the port. */
  const serve = async (fallback: string, byHost: Record<string, string> = {}): Promise<number> => {
    const context = (name: string) => ({ cert: pem(name), key: key(name) });
    const server = createServer({
      ...context(fallback),
      SNICallback: (servername, done) => done(null, createSecureContext(context(byHost[servername] ?? fallback))),
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    return (server.address() as AddressInfo).port;
  };
  /** Every connect the check makes, as asked for; the socket goes to the test server's port instead of 443. */
  let asked: ConnectionOptions[] = [];
  const toPort =
    (port: number): Connect =>
    (options) => {
      asked.push(options);
      return connect({ ...options, port });
    };
  const check = (port: number, deadlineMs = 5_000, env = "local", copy = pem("leafA")) =>
    servedLeafProblem({ env, copy, root: pem("root"), deadlineMs, connect: toPort(port) });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "served-leaf-"));
    make("root", ["basicConstraints=critical,CA:TRUE,pathlen:0", "keyUsage=critical,keyCertSign,cRLSign"]);
    make("leafA", LEAF, "root");
    make("leafB", LEAF, "root");
    make("other", ["basicConstraints=critical,CA:TRUE,pathlen:0", "keyUsage=critical,keyCertSign,cRLSign"]);
    make("leafC", LEAF, "other");
  });
  afterAll(() => {
    for (const server of servers) server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("served_leaf_equal_to_the_copy_passes", async () => {
    asked = [];
    expect(await check(await serve("leafA"))).toBeNull();
    // Architecture 02:58Z, conditions 1 and 4: the fixed edge address, each host as the servername, the dev root only.
    expect(
      asked.map(({ host, port, servername, rejectUnauthorized }) => [host, port, servername, rejectUnauthorized]),
    ).toEqual(HOSTS.map((host) => ["127.0.0.1", 443, host, true]));
    expect(asked.every((options) => options.ca === pem("root"))).toBe(true);
  });

  test("the_check_refuses_before_connecting_outside_local", async () => {
    // Architecture 02:58Z, conditions 2 and 3: under dev or prod, or for a name outside .localhost, nothing connects.
    asked = [];
    const port = await serve("leafA");
    for (const env of ["dev", "prod", "LOCAL", ""]) {
      expect(await check(port, 5_000, env), env).toBe("the leaf check runs only under --env local");
    }
    const outside = "the leaf names something other than hosts under .localhost";
    const sans: [string, string][] = [
      ["public", "DNS:app.example"],
      ["bare", "DNS:localhost"],
      // Not a reserved name: no RFC 2606 or 6761 name can test the .localhost suffix boundary itself (SE-7a,
      // suffix-boundary rule, last section of book edit verify-886-fixture-scope).
      ["suffix", "DNS:app.notlocalhost"],
      ["ip", "DNS:app.localhost,IP:127.0.0.1"],
    ];
    for (const [name, san] of sans) {
      make(
        name,
        ["basicConstraints=critical,CA:FALSE", `subjectAltName=${san}`, "extendedKeyUsage=serverAuth"],
        "root",
      );
      expect(await check(port, 5_000, "local", pem(name)), name).toBe(outside);
    }
    expect(asked).toEqual([]);
  });

  test("served_leaf_other_than_the_copy_fails_naming_the_file", async () => {
    expect(await check(await serve("leafB"))).toBe(
      "the edge serves a leaf other than unset-dev-env/local-leaf.pem: regenerate the leaf and its copy",
    );
  });

  test("every_local_host_is_checked", async () => {
    const port = await serve("leafA", { "pds.localhost": "leafB" });
    expect(await check(port)).toBe(
      "the edge serves a leaf other than unset-dev-env/local-leaf.pem: regenerate the leaf and its copy",
    );
  });

  test("served_leaf_from_another_root_fails_verification", async () => {
    expect(await check(await serve("leafC"))).toBe(
      "the edge's leaf does not verify against unset-dev-trust/root.pem (UNABLE_TO_VERIFY_LEAF_SIGNATURE): " +
        "regenerate unset-dev-env/local-leaf.pem",
    );
  });

  test("a_stalled_handshake_times_out", async () => {
    // Architecture 02:58Z condition 4: a listener that accepts and never answers the ClientHello fails closed at the
    // deadline, so local:up cannot hang (verify-903 S2).
    const stalled: TcpServer = createTcpServer(() => undefined);
    await new Promise<void>((ready) => stalled.listen(0, "127.0.0.1", ready));
    const port = (stalled.address() as AddressInfo).port;
    const started = Date.now();
    try {
      expect(await check(port, 1_500)).toBe("the edge did not answer in time");
      expect(Date.now() - started).toBeLessThan(4_000);
    } finally {
      stalled.close();
    }
  });

  test("the_probe_sends_nothing_and_closes_after_the_handshake", async () => {
    // Condition 4: handshake only. No application byte is written, and every socket ends destroyed (verify-903 S2).
    const port = await serve("leafA");
    const sockets: ReturnType<typeof connect>[] = [];
    let writes = 0;
    const counting: Connect = (options) => {
      const socket = connect({ ...options, port });
      const write = socket.write.bind(socket);
      const end = socket.end.bind(socket);
      socket.write = ((...args: Parameters<typeof write>) => {
        writes++;
        return write(...args);
      }) as typeof socket.write;
      socket.end = ((...args: Parameters<typeof end>) => {
        if (args[0] !== undefined && typeof args[0] !== "function") writes++;
        return end(...args);
      }) as typeof socket.end;
      sockets.push(socket);
      return socket;
    };
    const problem = await servedLeafProblem({
      env: "local",
      copy: pem("leafA"),
      root: pem("root"),
      deadlineMs: 5_000,
      connect: counting,
    });
    expect(problem).toBeNull();
    expect(sockets).toHaveLength(HOSTS.length);
    expect(writes).toBe(0);
    expect(sockets.every((socket) => socket.destroyed)).toBe(true);
  });

  test("an_edge_that_never_answers_fails_at_the_deadline", async () => {
    const port = await serve("leafA");
    servers.at(-1)?.close();
    await new Promise((settled) => setTimeout(settled, 50));
    expect(await check(port, 1_500)).toBe("the edge did not answer in time");
  });
});

describe("the leaf check's argv (pitfall node-reads-env-file-after-script)", () => {
  test("the_leaf_check_takes_only_the_node_separator_form", () => {
    // stack.ts calls `node served-leaf.ts -- --env <env>`; any other form is refused (verify-903-2f7413d S-1).
    expect(leafEnv(["--", "--env", "local"])).toBe("local");
    for (const argv of [
      [],
      ["--env", "local"],
      ["-", "--env", "local"],
      ["--", "--env"],
      ["--", "--env=local"],
      ["--", "--envs", "local"],
      ["--", "--", "--env", "local"],
      ["--", "--env", "local", "--env-file=x"],
    ]) {
      expect(leafEnv(argv), JSON.stringify(argv)).toBeNull();
    }
  });

  test("the_script_refuses_another_form_before_reading_a_file", () => {
    // Without the `--` the script prints the usage line and exits 1, reading no leaf or root to get there.
    const run = spawnSync(process.execPath, [join(import.meta.dirname, "served-leaf.ts"), "--env", "local"], {
      env: { PATH: process.env.PATH ?? "", NODE_OPTIONS: "" },
      encoding: "utf8",
    });
    expect([run.status, run.stderr]).toEqual([1, "leaf check: usage: served-leaf.ts -- --env local\n"]);
  });
});
