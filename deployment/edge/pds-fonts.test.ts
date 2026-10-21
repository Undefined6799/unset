// P2.24e: bounded PDS font policy and authoritative packaging provenance.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { edgeSiteProblems, PDS_FONT_POLICY, PDS_FONT_TEMPLATE, readCaddyfile } from "./caddyfile.ts";

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

test("PDS font response handling preserves the configured origin as a distinct token role", () => {
  for (const PDS_HOST of ["pds.unset.test", "pds.unset.localhost", "staging.unset.ac"]) {
    const config = readCaddyfile(
      `${read("Caddyfile").replaceAll(/^import .*$/gm, "")}\n${snippets()}\n${read("sites/pds.caddy")}`,
      { ...env, PDS_HOST },
    );
    const policy = config.snippet("pds-upstream", ["pds:3000"])[0];
    expect(policy?.name).toBe("reverse_proxy");
    expect(edgeSiteProblems(config)).toEqual([]);
    const response = policy?.block?.find((d) => d.name === "handle_response");
    expect(response?.args).toEqual([]);
    expect(response?.block?.at(-1)?.name).toBe("copy_response");
    const replacement = response?.block?.find((d) => d.name === "route")?.block?.[0]?.block?.[0];
    expect(replacement?.args.at(-1)).toBe(
      `\${1}; font-src https://${PDS_HOST}/_unset/fonts/SpaceGrotesk-Variable.woff2 https://${PDS_HOST}/_unset/fonts/JetBrainsMono-Variable.woff2`,
    );
    expect(replacement?.placeholders).toEqual([null, null]);
  }
});

const source = () => `${read("Caddyfile").replaceAll(/^import .*$/gm, "")}\n${snippets()}\n${read("sites/pds.caddy")}`;
const rejected = (text: string): boolean => {
  try {
    return (
      edgeSiteProblems(readCaddyfile(text, { ...env, APP_HOST: "app.unset.test", APP_UPSTREAM: "web:8080" })).length > 0
    );
  } catch {
    return true;
  }
};

test("font policy cannot run on an app proxy or before the XRPC guard", () => {
  const original = source();
  expect(rejected(original)).toBe(false);
  for (const changed of [
    original
      .replace("{$PDS_HOST} {", "{$APP_HOST} {")
      .replace("import pds-upstream {$PDS_UPSTREAM}", "import pds-upstream {$APP_UPSTREAM}"),
    original.replace("import pds-fonts\n", "").replace("import xrpc-guard", "import pds-fonts\nimport xrpc-guard"),
  ]) {
    expect(changed).not.toBe(original);
    expect(rejected(changed)).toBe(true);
  }
});

test("origin template has no meaning outside the exact replacement position", () => {
  for (const line of [
    `header X-Test "${PDS_FONT_TEMPLATE}"`,
    `respond "${PDS_FONT_TEMPLATE}"`,
    `import upstream "${PDS_FONT_TEMPLATE}"`,
  ])
    expect(rejected(`${snippets()}\n{$PDS_HOST} {\nroute {\n${line}\n}\n}`)).toBe(true);
  for (const bad of [
    PDS_FONT_TEMPLATE.replaceAll("https:", "http:"),
    PDS_FONT_TEMPLATE.replace("SpaceGrotesk", "Other"),
    `${PDS_FONT_TEMPLATE} https://evil.test/font.woff2`,
    PDS_FONT_TEMPLATE.replace("{$PDS_HOST}", "{host}"),
    PDS_FONT_TEMPLATE.replace("{$PDS_HOST}", "{$APP_HOST}"),
    PDS_FONT_TEMPLATE.replace("{$PDS_HOST}", "{$PDS_HOST}:443"),
  ])
    expect(rejected(source().replace(PDS_FONT_TEMPLATE, bad))).toBe(true);
  expect(() => readCaddyfile(source(), { ...env, PDS_HOST: "pds.unset.test:443" })).toThrow("wrong shape");
});

test("font mirrors bind both byte content and licences to authoritative inputs", () => {
  const provenance = JSON.parse(read("pds-fonts.json")) as { source: string; copy: string; sha256: string }[];
  expect(provenance.map((f) => f.copy)).toEqual([
    "pds-public/_unset/fonts/SpaceGrotesk-Variable.woff2",
    "pds-public/_unset/fonts/JetBrainsMono-Variable.woff2",
    "pds-licenses/OFL-SpaceGrotesk.txt",
    "pds-licenses/OFL-JetBrainsMono.txt",
  ]);
  const authoritative = JSON.parse(readFileSync(join(EDGE, "../../shared/ui/sheet/source.json"), "utf8")) as {
    files: { path: string; sha256: string }[];
  };
  for (const file of provenance) {
    const original = readFileSync(join(EDGE, "../..", file.source));
    expect(readFileSync(join(EDGE, file.copy))).toEqual(original);
    expect(createHash("sha256").update(original).digest("hex")).toBe(file.sha256);
    if (file.copy.endsWith("woff2"))
      expect(authoritative.files.find((f) => `shared/ui/${f.path}` === file.source)?.sha256).toBe(file.sha256);
  }
});

test("only the five proved complete policies match and retain their original bytes", () => {
  const hash = `'sha256-${"A".repeat(43)}='`;
  const base = `upgrade-insecure-requests; connect-src 'self'; default-src 'none'; frame-ancestors 'none'; img-src https:; script-src ${hash} 'self'; style-src 'self'`;
  const captcha = `upgrade-insecure-requests; connect-src 'self' https://hcaptcha.com https://*.hcaptcha.com; default-src 'none'; frame-ancestors 'none'; frame-src https://hcaptcha.com https://*.hcaptcha.com; img-src https:; script-src ${hash} 'self' https://hcaptcha.com https://*.hcaptcha.com; style-src 'self' https://hcaptcha.com https://*.hcaptcha.com`;
  const matcher = new RegExp(PDS_FONT_POLICY);
  for (const policy of [
    base,
    `${base} ${hash}`,
    `${base} ${hash}`.replace("img-src https:", "img-src https: data:"),
    captcha,
    captcha.replace("img-src https:", "img-src https: data:").replace("style-src 'self'", `style-src 'self' ${hash}`),
  ])
    expect(policy.replace(matcher, "$1; font-src fixed")).toBe(`${policy}; font-src fixed`);
  for (const policy of [
    "",
    `${base}, ${base}`,
    `${base},`,
    `,${base}`,
    `${base}\n`,
    `${base}; font-src 'self'`,
    base.replace("https:", "https: data:"),
    base.replace("connect-src 'self'", "connect-src *"),
    captcha.replace("https://*.hcaptcha.com", "https://*.example.test"),
    base.replace("A='", "B='"),
    base.replace("style-src 'self'", "style-src 'unsafe-inline'"),
  ])
    expect(matcher.test(policy), policy).toBe(false);
});

test("response and static grammar cannot be repurposed into request routes or broader file serving", () => {
  const original = source();
  for (const [from, to] of [
    ["type({http.reverse_proxy.header.Content-Security-Policy}) == string && ", ""],
    ["{http.reverse_proxy.status_code} == 200", "{http.reverse_proxy.status_code} == 201"],
    ["text/html; charset=utf-8", "text/html"],
    ["path /account /account/* /oauth/authorize /oauth/authorize/redirect", "path /*"],
    ["\t\t\t\t\tdefer\n", ""],
    ["copy_response\n", "copy_response 201\n"],
    ["route @ui {", "route {"],
    ["root /etc/caddy/pds-public", "root /etc/caddy"],
    ["public, max-age=0, must-revalidate", "public, max-age=31536000, immutable"],
    ["@font0 {", "@other {"],
    ["method GET HEAD", "method GET POST"],
  ] as const) {
    const changed = original.replace(from, to);
    expect(changed).not.toBe(original);
    expect(rejected(changed), from).toBe(true);
  }
  for (const text of [
    "{$PDS_HOST} {\nroute {\nroute {\nrespond 200\n}\n}\n}",
    "{$PDS_HOST} {\nroute {\nfile_server {\nroot /etc/caddy/pds-public\n}\n}\n}",
  ])
    expect(rejected(text)).toBe(true);
});

test("static font expressions require their complete matcher and guarded PDS font position", () => {
  const original = source();
  const expression = "expression `{http.request.orig_uri} == '/_unset/fonts/SpaceGrotesk-Variable.woff2'`";
  const unrelated = `@unrelated {\nmethod POST\n${expression}\n}\nrespond @unrelated 418\n`;
  const detached = `@font0 {\nmethod GET HEAD\n${expression}\n}\nrespond @font0 418\n`;
  const app = `${read("Caddyfile").replaceAll(/^import .*$/gm, "")}\n${snippets()}\n${read("local/app.caddy")}`;
  expect(rejected(original)).toBe(false);
  expect(rejected(app)).toBe(false);
  const completeEnv = { ...env, APP_HOST: "app.unset.test", APP_UPSTREAM: "web:8080" };
  for (const changed of [
    original.replace("import pds-fonts", `${unrelated}import pds-fonts`),
    original.replace("import pds-fonts", `${detached}import pds-fonts`),
    app.replace("import upstream {$APP_UPSTREAM}", `${unrelated}import upstream {$APP_UPSTREAM}`),
    app.replace("import upstream {$APP_UPSTREAM}", `${detached}import upstream {$APP_UPSTREAM}`),
  ])
    expect(rejected(changed), "injected matcher").toBe(true);
  for (const changed of [
    original.replace("import pds-fonts", `${unrelated}import pds-fonts`),
    app.replace("import upstream {$APP_UPSTREAM}", `${unrelated}import upstream {$APP_UPSTREAM}`),
  ])
    expect(() => readCaddyfile(changed, completeEnv)).toThrow("outside the exact PDS font form");
  for (const changed of [
    original.replace("import pds-fonts", `${detached}import pds-fonts`),
    app.replace("import upstream {$APP_UPSTREAM}", `${detached}import upstream {$APP_UPSTREAM}`),
  ]) {
    const config = readCaddyfile(changed, completeEnv);
    expect(edgeSiteProblems(config)).toContainEqual(expect.stringContaining("outside the guarded PDS font route"));
  }
  for (const [i, filename] of [
    [0, "SpaceGrotesk"],
    [1, "JetBrainsMono"],
  ] as const) {
    const full = `@font${i} {\n\t\tmethod GET HEAD\n\t\texpression \u0060{http.request.orig_uri} == '/_unset/fonts/${filename}-Variable.woff2'\u0060\n\t}`;
    for (const inline of [`@font${i} method GET HEAD`, `@font${i} path /_unset/fonts/*`]) {
      const changed = original.replace(full, inline);
      expect(changed).not.toBe(original);
      expect(() => readCaddyfile(changed, completeEnv), inline).toThrow("outside the exact PDS font form");
    }
  }
  const generic = app.replace(
    "import upstream {$APP_UPSTREAM}",
    "@ordinary {\nmethod POST\npath /ordinary\n}\nrespond @ordinary 418\n@fontOther {\nmethod GET\npath /other\n}\nrespond @fontOther 418\n@inline path /inline\nrespond @inline 418\nimport upstream {$APP_UPSTREAM}",
  );
  expect(rejected(generic)).toBe(false);
});
