// adapter-node's one body cap (BODY_SIZE_LIMIT, read when its handler loads; adapter-node 6.0.2 files/handler.js)
// must let the largest route's body through, or that route can never be used: a card save on /[did] takes up to
// 2 MiB while HTTP_BODY_LIMIT_BYTES is 64 KB. Each route's own limit stays the gate's (hooks.server.ts
// requestProblem): it refuses a declared Content-Length above the route's maxBody and a body with none, and SvelteKit
// stops reading past the declared length (kit 3.2.0 src/exports/node/index.js get_raw_body), so no route reads more
// than its own maxBody. The largest route is named here by a literal import, so dependency-cruiser follows it (rule
// AB-1, scripts/lint/semgrep/computed-import.yml); body-cap.test.ts reads every policy.ts and fails if another route
// takes more, or if this one stops being the largest.
import { policy as memberPage } from "../../routes/[did=did]/policy.ts";

/** The largest maxBody of any route: the member page's card save. */
export const BODY_CAP: number = memberPage.maxBody ?? 0;
