# 0015 — Web framework glue: Hono with server-rendered React and islands

Status: Accepted (pending merge). P1.20 spike, verdict PASS. Alex merges.

## Context
Plan §5.1 picks Hono, server-rendered React, CSS Modules and islands, with a typed CSP that has no nonces and a
path-scoped `script-src`. Q3 asked whether the glue between them stays small, about 600 lines, or whether a framework
should own it. Step P1.20 (docs/ai/book/phase-1.md, "P1.20 — Framework-glue spike") measures that on one fixture,
for Hono and, for one timeboxed day, Astro. The spike code is not merged: it stays on branch
`claude/phase-2-blocks-p201k-p120` under `spikes/`, and P1.23 starts from it.

## Fixture
The same four routes for each candidate:
- `GET /` server-renders a shared `Box` (styled by `Box.module.css`) and two islands that also render `Box`: `Counter`
  (local state) and `Search` (fetches `/api/echo`).
- `GET /@demo` is a zero-JS profile-style page that renders `Box` only.
- `POST /form` is a stub CSRF check (`Sec-Fetch-Site: same-origin`, else 403), then a 303 to `/?ok=1`.
- `GET /api/echo` is a JSON echo.
- `GET /neg` exists on the test server only. It is a negative control with a React `style={{ color: "red" }}`, which
  the CSP must block.

Production pages are served with step 3's CSP, with the host replaced by localhost. App routes allow `script-src` and
`style-src` from `/assets/` only, plus `require-trusted-types-for 'script'` and `trusted-types 'none'`. `/@demo` gets
the same policy without `script-src` and `connect-src`.

## Versions
Exact versions, from the npm registry on 2026-10-06:
- Hono candidate: `hono` 4.13.10, `@hono/node-server` 2.1.1, `@hono/vite-dev-server` 0.26.1, `vite` 8.3.1
  (Rolldown), `@vitejs/plugin-react` 6.1.2, `react` and `react-dom` 19.2.8.
- Astro candidate: `astro` 7.3.5, `@astrojs/react` 7.0.0, `@astrojs/node` 11.1.6, `react` and `react-dom` 19.2.8.
- Measuring: `playwright-core` 1.56.1 driving Chromium 141 (`/opt/pw-browsers/chromium-1194`); Node 26.10.0.

## Measurements
Each candidate's raw reports and `MEASUREMENTS.json` are in [`evidence/0015-web-framework-glue/`](evidence/0015-web-framework-glue/).
`scripts/docs/glue-spike.test.ts` (`hono_verdict_consistent`) recomputes Hono's numbers and verdict from the raw
reports alone.

| | Hono | Astro |
|---|---|---|
| Glue lines (rule below) | 150 | 30 |
| CSS class maps identical, server and client | prod yes, dev yes | prod yes, dev not measured |
| Hydration errors (Chromium) | 0 | 0 with the CSP off; the islands never run with it on |
| CSP or Trusted Types violations on `/` and `/@demo` | 0 | 3: two inline `<script>`s and one inline `<style>` |
| Style-attribute violations on `/neg` (must be ≥1) | 1 | 1 |
| `/@demo`: script tags, module preloads, JS bytes | 0, 0, 0 | 0, 0, 0 |
| React runtime, gzip -9 | 58,886 B | 60,089 B |
| Bootstrap, gzip -9 | 1,234 B (`boot` plus Rolldown's runtime) | 1,834 B (inline `astro-island` scripts) |
| Per island, gzip -9 (≤15 KiB) | Counter 551 B, Search 646 B | Counter 586 B, Search 682 B |
| Page total, gzip -9 (≤75 KiB) | 61,009 B | 62,843 B |
| Headroom for 75 KiB (must be ≥15 KiB) | 16,680 B | 14,877 B |
| Clean build, median of 3 | 1.85 s | 2.66 s |
| Dependencies, direct and transitive | 11 and 31 | 8 and 213 |

Hono's glue in lines:
- dev SSR 16, manifest 19, CSS 7, islands (server `Island` and client `boot`) 39, serialiser 2;
- page shell and production serving 33;
- functions in `vite.config.ts` and the measurement config 34. Their 13 declarative lines are within the free 80.

The measurement config only adds the class-map hook.

**Units.** "KB" in plan §6.1 is read as KiB (1,024 bytes), as the step book reads every other §6.1 budget (P1.21,
`budget.css.json`). Hono's headroom is 1,320 B over 15 KiB.

**The counting rule** (`scripts/budgets/count-glue-lines.ts`, also used by P1.23 and P1.38):
- Count every non-blank, non-comment line of a `.ts` or `.tsx` file under the glue folder, test files excluded.
- In a config file passed with `--config`, count every line inside a function (a plugin, a hook, a callback).
- A config file's other, declarative lines are free up to 80; every line beyond 80 counts.

**Browsers.** Only Chromium is installed where the spike ran, so `hydrationErrorsByEngine` has `firefox` and
`webkit` as `null`, meaning not measured. The verdict uses Chromium's count (step book record
2026-10-06-p120-split-and-browsers.md).

**Re-checks.**
- P1.26's `hydration_errors_all_engines` runs Chromium, Firefox and WebKit on the real app. A failure there reopens
  this ADR.
- P1.23's CI warns when its glue exceeds the accepted number, 150 lines, counted with the same rule.

## Verdict
**Hono: PASS.** Every condition of step 5 holds:
- glue is 150 lines, against a limit of 600;
- CSS is identical in dev and prod;
- there are 0 hydration errors and 0 CSP or Trusted Types violations;
- `/neg` is blocked, and only `/neg`;
- `/@demo` ships no JS;
- the headroom of 16,680 B is at least 15 KiB, and each island is under 15 KiB.

The React runtime is under 60 KB, so there is no budget problem for Alex.

**Astro: FAIL**, measured within its day.
- Every island page carries the `astro-island` runtime and the `client:load` directive as inline `<script>`s, plus an
  inline `<style>`. Under the plan's CSP the islands never hydrate.
- Astro 7.3.5's own `security.csp` admits them only by hashing them. Step 5 counts a hash-only fix as FAIL.
- Astro 7.3.5 can send that CSP as a header, not only a `<meta>`, so step 6b no longer holds as written.
- Its headroom of 14,877 B also misses the budget.

**React Router 8** was not built (step 7); the cost of switching is in the table below.

## Consequences

| Outcome | Steps that change |
|---|---|
| Hono PASS (this ADR) | Nothing in substance. P1.23 productionises the spike glue; P1.21 relies on the deterministic `generateScopedName`; P1.08 registers `script-src https://<app host>/assets/`. |
| Had Alex chosen React Router 8 | P1.23 becomes "RR8 route modules": `<Scripts/>` omitted for zero-JS route groups, per-route headers, the P1.07 gate as RR middleware. Loader data is serialised by RR's own encoder, which needs its own escaping review [SEC]. The per-island budget becomes a per-route budget (about 45 KB gzipped baseline) and §6.1's 75 KB total is re-checked with Alex. P1.25 becomes RR layout routes; P2.21's preview hydrates at route level. |
| Had Alex chosen Astro | §5.1's "no nonces, path-scoped `script-src`" cannot hold without hashes for the inline island runtime, so Alex decides before any further step; P1.07 and P1.08 run as Astro middleware; P1.23 becomes Astro island configuration; P2.20 renders from `.astro` pages (a fourth syntax; the fixture needed three `.astro` files). |

**Streaming.** `renderToString` was enough: every island and every CSS link is known before the first byte. Moving to
`renderToReadableStream` later would need the `<link>` tags and the bootstrap tag written before the body streams. It
would also need the island list collected as the stream renders. No slice-1 page needs it.

**Dev-only deviations.** These hold in development only:
- The dev page loads `/@vite/client` and `/_dev/refresh-preamble` as external module scripts, so there is still no
  inline script.
- Each CSS Module is linked as `<path>?direct`, which Vite serves as plain CSS. That causes no flash of unstyled
  content.
- The dev server ran without a CSP. A dev CSP would need `script-src 'self'` and `connect-src ws:` for HMR. That is
  unverified until P1.23 runs it.

**One finding for P1.23.** `@hono/vite-dev-server` 0.26.1 skips every `/@…` path by default (`dist/dev-server.mjs`,
line 15). That hides profile URLs such as `/@handle`, and it skips `.js` paths. The spike narrows the exclusion to
Vite's own prefixes (`/@vite`, `/@react-refresh`, `/@id`, `/@fs`), and it serves the preamble at a path without an
extension.

## Carried into P1.23
From `spikes/p1-20-hono/` on the spike branch:
- `src/glue/manifest.ts`: the manifest read once at boot, and the CSS walk over imported chunks.
- `src/glue/css.ts` and `src/glue/styles.ts`: one client entry imports every CSS Module, so the CSS links are known
  for SSR.
- `src/glue/islands.tsx` (`Island`) and `src/glue/boot.ts`. The bootstrap imports islands one after another; P1.23
  may import them in parallel.
- `src/glue/document.tsx` and `src/glue/dev-ssr.ts` (the external refresh preamble).
- The `vite.config.ts` parts: `generateScopedName`, a `sha256` of the repo-relative path and the class name; the
  React chunk split; and the narrowed dev-server `exclude`.

`serialiser.ts` stays P1.10's. The CSP strings in `entry-server.tsx` are only the fixture's harness; P1.08 builds the
real ones.
