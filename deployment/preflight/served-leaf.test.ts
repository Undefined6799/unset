// P1.34d item 15: the check `local:up` runs after start, against a real TLS server on a loopback port standing in for
// the edge, with throwaway certificates from the openssl on this machine. Nothing here starts Docker.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecureContext, createServer, type Server } from "node:tls";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { servedLeafProblem } from "./served-leaf.ts";

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
  const check = (port: number, deadlineMs = 5_000) =>
    servedLeafProblem({ hosts: HOSTS, copy: pem("leafA"), root: pem("root"), port, deadlineMs });

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
    expect(await check(await serve("leafA"))).toBeNull();
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

  test("an_edge_that_never_answers_fails_at_the_deadline", async () => {
    const port = await serve("leafA");
    servers.at(-1)?.close();
    await new Promise((settled) => setTimeout(settled, 50));
    expect(await check(port, 1_500)).toBe("the edge did not answer in time");
  });
});
