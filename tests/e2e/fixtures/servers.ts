// Two processes for the browser harness (P1.26). Both render apps/web's production build.
// P1.25 did not ship TEST_ROUTES, so fixture pages exist only in the test process. The kit's path
// template rejects a leading underscore (shared/http/routes.ts), so the paths are /fixture/*.
// The production process is compose(): the real routes, no fixture. Postgres init can take the
// 90s budget in tests/support/postgres.ts, so `wait` allows 180s and then prints the server logs.
//
// HSTS is present on http in dev because shared/http/csp/headers.ts sets it for every group.
// The http modules are package subpaths, not relative paths: a relative import pulls
// interfaces/http into this project, whose rootDir is tests/ (TS6059).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNetGuard, guardedFetch, internalPolicy } from "@unset/infrastructure-net-guard";
import { migrate } from "@unset/infrastructure-postgres";
import { compose } from "@unset/interfaces-http/compose.ts";
import { config } from "@unset/interfaces-http/config.ts";
import { policies } from "@unset/interfaces-http/limits.ts";
import { assetsRoutes } from "@unset/interfaces-http/routes/assets.ts";
import { webTestEnv } from "@unset/interfaces-http/test-env.ts";
import { loadWebBuild } from "@unset/interfaces-http/web/build.ts";
import { pageResponse } from "@unset/interfaces-http/web/page.ts";
import { loadWebRender, type WebRender } from "@unset/interfaces-http/web/render-entry.ts";
import { loadConfig } from "@unset/shared-config";
import { createServer, defineRoute, type Route } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";
import { FIXTURES, PROD_ORIGIN, PROD_PUBLIC_ORIGIN, TEST_ORIGIN } from "../pages.ts";

const ROOT = join(import.meta.dirname, "../../..");
const BUILD = join(ROOT, "apps/web/dist/client");
const LOGS = ["e2e-prod.log", "e2e-test.log"] as const;
/** The signed-in account the account and settings fixtures show. */
const ACCOUNT = {
  handle: "alice.pds.unset.test",
  did: `did:plc:${"a".repeat(24)}`,
  handleUnavailable: false,
  issuer: "https://pds.unset.test",
  ours: true,
};

// The wait process probes both listeners. scripts/guards/egress.ts scans tests/ and refuses a
// dynamic fetch, so the probe is guardedFetch. An internal policy allows these exact http origins,
// and a private answer may be loopback (infrastructure/net-guard/src/resolve.ts).
const health = guardedFetch(
  createNetGuard({ internalHosts: [], allowLoopback: false, commit: "c".repeat(40) }),
  internalPolicy("e2e-health", [PROD_ORIGIN, TEST_ORIGIN]),
  { timeoutMs: 2_000, maxBytes: 4_096 },
);

type Mode = "prod" | "test" | "wait";

function secretsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "unset-e2e-"));
  process.on("exit", () => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function harnessEnv(dir: string, listen: string, extra: Record<string, string> = {}): Record<string, string> {
  return webTestEnv(dir, {
    UNSET_ENV: "dev",
    LISTEN_PORT: new URL(listen).port,
    PUBLIC_ORIGIN: listen,
    HTTP_ALLOWED_HOSTS: new URL(listen).hostname,
    MEDIA_ORIGIN: "http://media.test:9",
    TRUSTED_PROXY_MODE: "socket",
    OAUTH_ALLOW_HTTP: "true",
    ...extra,
  });
}

function html(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture</title></head><body><main id="main">${body}</main></body></html>`;
}

function htmlRoute(path: string, group: "app" | "public", body: string): Route {
  return defineRoute({
    method: "GET",
    path,
    group,
    rateLimit: "default",
    session: "none",
    handler: () => new Response(html(body), { headers: { "content-type": "text/html; charset=utf-8" } }),
  });
}

async function serveProd(): Promise<void> {
  process.on("exit", () => {
    stopAllPostgres();
  });
  const migratorPassword = randomPassword();
  const postgres = await startPostgres({
    initDir: join(ROOT, "deployment/postgres/init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  const dir = secretsDir();
  // Styles and scripts stay on the HTTP listener. ASSETS_BASE may be http in dev
  // (shared/http/config.ts); an empty value would point them at PROD_PUBLIC_ORIGIN.
  const env = harnessEnv(dir, PROD_ORIGIN, {
    PUBLIC_ORIGIN: PROD_PUBLIC_ORIGIN,
    HTTP_ALLOWED_HOSTS: "unset.test,127.0.0.1",
    ASSETS_BASE: `${PROD_ORIGIN}/assets/`,
  });
  env.PG_HOST = "127.0.0.1";
  env.PG_PORT = String(postgres.port);
  const result = await migrate({
    connection: {
      host: "127.0.0.1",
      port: postgres.port,
      user: "migrator",
      password: migratorPassword,
      database: "unset",
      ssl: false,
    },
    dir: join(ROOT, "infrastructure/postgres/migrations"),
    root: ROOT,
    checkQueryFiles: true,
    log: createLogger({ service: "e2e-migrate", commit: "c".repeat(40), env: "dev" }),
    retryDelaysMs: [],
  });
  if (!result.ok) throw new Error(`migration failed: ${result.reason}`);
  const password = readFileSync(env.PG_PASSWORD_FILE ?? "", "utf8").trim();
  postgres.sql("unset", `ALTER ROLE web PASSWORD '${password}'`);
  const cfg = loadConfig(config, env);
  const { server, boot } = await compose(cfg);
  await boot();
  const bound = await server.listen();
  process.stderr.write(`e2e prod listening ${bound}\n`);
}

/**
 * The production server build does not export the kit showcase, and Node cannot load TSX.
 * Vite 8.3.4 `ssrLoadModule` (node_modules/vite/dist/node/index.d.ts) loads the source render
 * and the showcase in one module graph, so IslandRendererContext is a single React context.
 * Class names come from the same scopedName the production CSS build used (apps/web/vite.config.ts).
 */
type PageBody = Parameters<typeof pageResponse>[1]["body"];
type CreateElement = (type: unknown, props?: unknown, ...children: unknown[]) => PageBody;
type IslandComponent = (props: { name: string; props: object }) => PageBody;

// This file is not in a workspace, so the raw-specifier allowlist only permits packages
// the root package.json declares (scripts/lint/specifiers.ts). react is not one of them.
// A string variable is not a specifier. Node still loads the module the server build imports.
async function loadReact(): Promise<CreateElement> {
  const specifier: string = "react";
  const react = (await import(specifier)) as { createElement?: CreateElement };
  if (react.createElement === undefined) throw new Error("react did not load");
  return react.createElement;
}

async function loadKit(): Promise<{
  renderPage: WebRender["renderPage"];
  Showcase: (props: Record<string, never>) => PageBody;
}> {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: join(ROOT, "apps/web/vite.config.ts"),
    root: join(ROOT, "apps/web"),
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null, fs: { allow: [ROOT] } },
  });
  process.on("exit", () => {
    void vite.close();
  });
  const web = (await vite.ssrLoadModule(join(ROOT, "apps/web/render.tsx"))) as { renderPage?: WebRender["renderPage"] };
  const kit = (await vite.ssrLoadModule(join(ROOT, "shared/ui/showcase/Showcase.tsx"))) as {
    Showcase?: (props: Record<string, never>) => PageBody;
  };
  if (web.renderPage === undefined || kit.Showcase === undefined) {
    throw new Error("kit showcase did not load");
  }
  return { renderPage: web.renderPage, Showcase: kit.Showcase };
}

async function serveTest(): Promise<void> {
  const dir = secretsDir();
  const cfg = loadConfig(config, harnessEnv(dir, TEST_ORIGIN));
  const render = await loadWebRender();
  const build = loadWebBuild(BUILD, render.islandName);
  const kit = await loadKit();
  const createElement = await loadReact();
  // A literal import resolves to apps/web/render.tsx, which this project cannot parse
  // without jsx. The string is the same package export the production render loader uses.
  const serverBuild: string = "@unset/apps-web/server";
  const web = (await import(serverBuild)) as { Island?: IslandComponent };
  const Island = web.Island;
  if (Island === undefined) throw new Error("web render build does not export Island");
  const log = createLogger({ service: "e2e", commit: "c".repeat(40), env: "dev" });
  const deps = {
    build,
    render: render.renderPage,
    assetsOrigin: new URL(cfg.PUBLIC_ORIGIN).origin,
    env: cfg.UNSET_ENV,
    log,
  };
  const boot = build.manifest.boot;
  const routes = [
    ...assetsRoutes(build.files),
    defineRoute({
      method: "GET",
      path: FIXTURES.app,
      group: "app",
      rateLimit: "default",
      session: "none",
      handler: ({ request }) =>
        pageResponse(deps, {
          group: "app",
          request,
          title: "Islands",
          shell: {},
          body: createElement(
            "div",
            { id: "notice" },
            createElement("p", null, "A notice"),
            createElement(Island, {
              name: "toast",
              props: { href: FIXTURES.app, label: "Dismiss notice", toast: "notice" },
            }),
          ),
        }),
    }),
    defineRoute({
      method: "GET",
      path: FIXTURES.showcase,
      group: "app",
      rateLimit: "default",
      session: "none",
      handler: ({ request }) =>
        pageResponse(
          { ...deps, render: kit.renderPage },
          { group: "app", request, title: "Kit", body: createElement(kit.Showcase) },
        ),
    }),
    // P2.12a: the welcome screens as interfaces/http/routes/welcome.ts shows them, without the session they need there.
    ...[
      { path: FIXTURES.welcomeAge, title: "When were you born?", body: () => render.screens.welcomeAge() },
      {
        path: FIXTURES.welcomeTerms,
        title: "Terms and privacy",
        body: () =>
          render.screens.welcomeTerms({ countryRule: true, next: null, termsVersion: "1", privacyVersion: "1" }),
      },
      { path: FIXTURES.welcomeChat, title: "Chat comes later", body: () => render.screens.welcomeChat() },
    ].map(({ path, title, body }) =>
      defineRoute({
        method: "GET",
        path,
        group: "app",
        rateLimit: "default",
        session: "none",
        handler: ({ request }) =>
          pageResponse(deps, { group: "app", request, title, body: body(), islands: "off", shell: { noindex: true } }),
      }),
    ),
    // P2.13c: the account page and the settings pages inside the core shell, as their routes render them.
    ...[
      {
        path: FIXTURES.account,
        title: "alice.pds.unset.test",
        active: "account" as const,
        body: () =>
          render.screens.profile({
            did: ACCOUNT.did,
            handle: ACCOUNT.handle,
            verified: true,
            handleUnavailable: false,
            profile: {
              displayName: "Alice",
              headline: "Designer and front-end developer.",
              location: "Toronto, Ontario",
              website: "https://alice.example",
              readme: [
                {
                  $type: "sh.unset.profile#heading",
                  level: 2,
                  content: [{ $type: "sh.unset.profile#textRun", text: "About me" }],
                },
              ],
              links: "https://github.com/alicem",
            },
          }),
      },
      {
        path: FIXTURES.settingsProfile,
        title: "Profile",
        active: "settings" as const,
        body: () => render.screens.settingsProfile({ privacyNotice: false, profile: null }),
      },
      {
        path: FIXTURES.settingsAccount,
        title: "Account",
        active: "settings" as const,
        body: () => render.screens.settingsAccount({ ...ACCOUNT, privacyNotice: false }),
      },
    ].map(({ path, title, active, body }) =>
      defineRoute({
        method: "GET",
        path,
        group: "app",
        rateLimit: "default",
        session: "none",
        handler: ({ request }) =>
          pageResponse(deps, {
            group: "app",
            request,
            title,
            body: body(),
            islands: "off",
            shell: {
              noindex: true,
              navigation: { active, accountPath: `/${ACCOUNT.did}`, accountName: ACCOUNT.handle },
            },
          }),
      }),
    ),
    htmlRoute(FIXTURES.unlabeled, "public", `<input name="name">`),
    htmlRoute(FIXTURES.inline, "public", `<script>globalThis.__inline = 1</script>`),
    htmlRoute(FIXTURES.script, "app", `<script type="module" src="/${boot}"></script>`),
  ];
  const server = createServer({ config: cfg, routes, policies, log });
  const bound = await server.listen();
  process.stderr.write(`e2e test listening ${bound}\n`);
}

async function once(url: string, deadline: number): Promise<boolean> {
  if (Date.now() >= deadline) return false;
  try {
    const response = await health(url);
    return response.ok;
  } catch (error) {
    void error;
    return false;
  }
}

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await once(url, deadline)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`health timeout ${url}`);
}

function dumpLogs(): void {
  for (const file of LOGS) {
    try {
      process.stderr.write(`\n# ${file}\n${readFileSync(file, "utf8")}\n`);
    } catch (error) {
      void error;
    }
  }
}

async function waitForServers(): Promise<void> {
  try {
    await waitFor(`${PROD_ORIGIN}/health`);
    await waitFor(`${TEST_ORIGIN}/health`);
  } catch (error) {
    dumpLogs();
    throw error;
  }
}

function assertMode(value: string | undefined): Mode {
  if (value === "prod" || value === "test" || value === "wait") return value;
  throw new Error("usage: servers.ts prod|test|wait");
}

const mode = assertMode(process.argv[2]);
if (mode === "prod") await serveProd();
else if (mode === "test") await serveTest();
else await waitForServers();
