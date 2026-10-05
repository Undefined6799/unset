// The CSP builder (P1.08): one policy per route group, built from the typed allowlist in sources.ts.
import { describe, expect, test } from "vitest";
import type { RouteGroup } from "../routes.ts";
import { buildCsp } from "./build.ts";
import { cspOrigins, securityHeaders } from "./headers.ts";
import { policiesFor } from "./policies.ts";
import { configOrigin, type Source } from "./sources.ts";

const GROUPS: readonly RouteGroup[] = ["app", "profile", "static", "media", "admin", "api"];
const PROD = {
  UNSET_ENV: "prod",
  PUBLIC_ORIGIN: "https://unset.sh",
  MEDIA_ORIGIN: "https://unsetcdn.net",
  ASSETS_BASE: "",
  DEV_VITE_ORIGIN: "",
} as const;
const DEV = {
  UNSET_ENV: "dev",
  PUBLIC_ORIGIN: "http://localhost:8080",
  MEDIA_ORIGIN: "http://127.0.0.1:8081",
  ASSETS_BASE: "",
  DEV_VITE_ORIGIN: "http://localhost:5173",
} as const;
const built = (cfg: typeof PROD | typeof DEV) => {
  const policies = policiesFor(cspOrigins(cfg));
  return GROUPS.map((group) => [group, buildCsp(policies[group])] as const);
};
const directive = (csp: string | undefined, name: string) =>
  csp === undefined ? undefined : csp.split("; ").find((d) => d === name || d.startsWith(`${name} `));

describe("csp policies", () => {
  test("snapshot_per_group", () => {
    expect(Object.fromEntries(built(PROD))).toMatchSnapshot("prod");
    expect(Object.fromEntries(built(DEV))).toMatchSnapshot("dev");
  });

  test("no_unsafe_tokens", () => {
    for (const [group, csp] of [...built(PROD), ...built(DEV)]) {
      for (const token of ["'unsafe-", "'strict-dynamic'", "nonce-", "data:", "https:", " * ", "*;"]) {
        // `https:` may appear only as part of a full origin, never as a bare scheme source.
        const bare = token === "https:" ? / https:(?: |;|$)/.test(csp) : csp.includes(token);
        expect(bare, `${group} contains ${token}`).toBe(false);
      }
      expect(csp.endsWith("*"), group).toBe(false);
    }
  });

  test("form_action_self_everywhere", () => {
    for (const [group, csp] of [...built(PROD), ...built(DEV)]) {
      const formAction = directive(csp, "form-action");
      if (formAction !== undefined) expect(formAction, group).toBe("form-action 'self'");
    }
    expect(directive(Object.fromEntries(built(PROD)).app, "form-action")).toBe("form-action 'self'");
    expect(directive(Object.fromEntries(built(PROD)).profile, "form-action")).toBe("form-action 'self'");
  });

  test("source_type_rejects_wildcards", () => {
    // @ts-expect-error a scheme source is not a Source
    const scheme: Source = "https:";
    // @ts-expect-error a wildcard is not a Source
    const star: Source = "*";
    // @ts-expect-error an unsafe keyword is not a Source
    const unsafe: Source = "'unsafe-inline'";
    // @ts-expect-error an origin must come from config, not a plain string
    const raw: Source = { origin: "https://evil.example" };
    expect([scheme, star, unsafe, raw]).toHaveLength(4);
    expect(() => configOrigin("MEDIA_ORIGIN", "https://unsetcdn.net/x")).toThrow("MEDIA_ORIGIN invalid");
    expect(() => configOrigin("MEDIA_ORIGIN", "*")).toThrow("MEDIA_ORIGIN invalid");
  });

  test("profile_has_no_script_src", () => {
    for (const [, csp] of [...built(PROD), ...built(DEV)].filter(([g]) => g === "profile")) {
      expect(directive(csp, "script-src")).toBeUndefined();
      expect(directive(csp, "default-src")).toBe("default-src 'none'");
    }
  });

  test("media_group", () => {
    const headers = securityHeaders("media", PROD);
    expect(headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(securityHeaders("app", PROD)["cross-origin-resource-policy"]).toBe("same-origin");
  });

  test("dev_origin_only_in_dev", () => {
    // config.ts refuses DEV_VITE_ORIGIN outside dev; the builder also ignores it there.
    const prod = policiesFor(cspOrigins({ ...PROD, DEV_VITE_ORIGIN: "http://localhost:5173" }));
    expect(buildCsp(prod.app)).not.toContain("localhost");
    expect(directive(Object.fromEntries(built(DEV)).app, "connect-src")).toBe(
      "connect-src 'self' http://localhost:5173 ws://localhost:5173",
    );
  });

  test("assets_base_used", () => {
    const csp = buildCsp(policiesFor(cspOrigins({ ...PROD, ASSETS_BASE: "https://static.unset.sh/assets/" })).app);
    expect(directive(csp, "script-src")).toBe("script-src https://static.unset.sh/assets/");
  });
});
