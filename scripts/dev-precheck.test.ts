// P1.29s: the local precheck refuses a production host and a foreign PDS DID, and it never creates an account.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  CLI_OPTIONS,
  DEV_HOST,
  didVerdict,
  expectedDid,
  hostnamePin,
  main,
  PRODUCTION_HOST,
  PRODUCTION_HOST_CODE,
  PrecheckError,
  parse,
  pdsHostnameFromEnv,
  precheck,
  UNKNOWN_DID_CODE,
} from "./dev-precheck.ts";

const FOREIGN_DID = `did:plc:${"a".repeat(24)}`;
const LOCAL = "pds.unset.localhost";
const ENV = "PDS_HOSTNAME=pds.unset.localhost\n";

const walk = (dir: string, files: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "fixtures" || entry.name === "node_modules" || entry.name === "dist") continue;
      walk(path, files);
    } else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) files.push(path);
  }
};

describe("dev-precheck (P1.29s)", () => {
  test("precheck_refuses_production_host", async () => {
    const preflight = async (): Promise<number> => {
      throw new Error("preflight must not run");
    };
    const describeServer = async (): Promise<null> => null;
    const cases: [string, string, string][] = [
      ["local", PRODUCTION_HOST, PRODUCTION_HOST_CODE],
      ["dev", PRODUCTION_HOST, PRODUCTION_HOST_CODE],
      ["local", "UNSET.AC.", PRODUCTION_HOST_CODE],
      ["dev", "unset.ac:443", PRODUCTION_HOST_CODE],
      ["local", DEV_HOST, PRODUCTION_HOST_CODE],
      ["dev", LOCAL, PRODUCTION_HOST_CODE],
      ["local", "", PRODUCTION_HOST_CODE],
    ];
    for (const [env, host, code] of cases) {
      const result = await precheck({
        env: env as "local" | "dev",
        pdsHostname: host,
        describeServer,
        preflight,
      });
      expect(result, `${env} ${host}`).toEqual({ code: 2, reason: code });
    }
    expect(hostnamePin("local", PRODUCTION_HOST)).toBe(PRODUCTION_HOST_CODE);
    expect(hostnamePin("dev", DEV_HOST)).toBe("ok");
    expect(hostnamePin("local", LOCAL)).toBe("ok");
  });

  test("precheck_refuses_unknown_pds_did", async () => {
    // Stub describeServer answering a foreign DID (the old prototype, or any other PDS).
    let preflightRan = 0;
    const result = await precheck({
      env: "local",
      pdsHostname: LOCAL,
      describeServer: async () => ({ did: FOREIGN_DID }),
      preflight: async () => {
        preflightRan += 1;
        return 0;
      },
    });
    expect(result).toEqual({ code: 2, reason: UNKNOWN_DID_CODE });
    expect(preflightRan).toBe(0);
    expect(JSON.stringify(result)).not.toContain(FOREIGN_DID);
    expect(JSON.stringify(result)).not.toContain(LOCAL);
    expect(didVerdict(DEV_HOST, { did: FOREIGN_DID })).toBe(UNKNOWN_DID_CODE);
    expect(didVerdict(DEV_HOST, { did: `did:web:other.${DEV_HOST}` })).toBe(UNKNOWN_DID_CODE);
  });

  test("precheck_admits_expected_did_or_absent_then_preflight", async () => {
    const answers: Array<{ did?: string } | null> = [{ did: expectedDid(LOCAL) }, {}, { did: "" }, null];
    for (const answer of answers) {
      let preflightRan = 0;
      const result = await precheck({
        env: "local",
        pdsHostname: LOCAL,
        describeServer: async () => answer,
        preflight: async () => {
          preflightRan += 1;
          return 0;
        },
      });
      expect(result, JSON.stringify(answer)).toEqual({ code: 0 });
      expect(preflightRan).toBe(1);
    }
    const failed = await precheck({
      env: "dev",
      pdsHostname: DEV_HOST,
      describeServer: async () => ({ did: expectedDid(DEV_HOST) }),
      preflight: async () => 1,
    });
    expect(failed).toEqual({ code: 2 });
  });

  test("cli_flags_are_not_ones_node_reads", () => {
    const names = Object.keys(CLI_OPTIONS);
    expect(names).toEqual(["env", "compose", "interpolation-env"]);
    for (const name of names) expect(name, name).not.toMatch(/^(env-file|require|import)/);
    expect(parse(["--", "--env", "local", "--compose", "c.yaml", "--interpolation-env", "e.env"])).toEqual(
      parse(["--env", "local", "--compose", "c.yaml", "--interpolation-env", "e.env"]),
    );
    expect(() => parse(["--", "--", "--env", "local", "--compose", "c.yaml", "--interpolation-env", "e.env"])).toThrow(
      PrecheckError,
    );
    expect(() => parse(["--env", "prod", "--compose", "c.yaml", "--interpolation-env", "e.env"])).toThrow(
      PrecheckError,
    );
  });

  test("main_prints_only_the_fixed_code", async () => {
    const wrote: string[] = [];
    const code = await main(
      ["--env", "local", "--compose", "c.yaml", "--interpolation-env", "e.env"],
      {
        readEnvText: () => "PDS_HOSTNAME=unset.ac\n",
        describeServer: async () => {
          throw new Error("must not describe a production host");
        },
        preflight: async () => {
          throw new Error("must not run");
        },
      },
      (line) => wrote.push(line),
    );
    expect(code).toBe(2);
    expect(wrote).toEqual([`${PRODUCTION_HOST_CODE}\n`]);
    expect(wrote.join("")).not.toContain("unset.ac");
    const unknown = await main(
      ["--env", "local", "--compose", "c.yaml", "--interpolation-env", "e.env"],
      {
        readEnvText: () => ENV,
        describeServer: async () => ({ did: FOREIGN_DID }),
        preflight: async () => 0,
      },
      (line) => wrote.push(line),
    );
    expect(unknown).toBe(2);
    expect(wrote.at(-1)).toBe(`${UNKNOWN_DID_CODE}\n`);
    expect(pdsHostnameFromEnv(ENV)).toBe(LOCAL);
    expect(pdsHostnameFromEnv("PDS_HOSTNAME=a\nPDS_HOSTNAME=b\n")).toBeNull();
  });

  test("no_create_account_in_scripts", () => {
    const files: string[] = [];
    walk(join(import.meta.dirname), files);
    const create = /\bcreateAccount\s*\(|com\.atproto\.server\.createAccount/;
    const hits = files.filter((file) => create.test(readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
  });

  test("no_seeded_json", () => {
    const files: string[] = [];
    walk(join(import.meta.dirname), files);
    const hits = files.filter((file) => readFileSync(file, "utf8").includes(".seeded.json"));
    expect(hits).toEqual([]);
  });
});
