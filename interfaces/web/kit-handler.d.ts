// The shape server.ts uses of adapter-node's build/handler.js (adapter-node 6.0.2 files/handler.js exports `handler`, a
// Polka-style middleware). package.json "imports" maps `#kit/handler` to the build for Node and to this file for the
// type checker, so server.ts names it by a literal specifier (scripts/lint/semgrep/computed-import.yml) and tsc never
// walks the build output.
import type { IncomingMessage, ServerResponse } from "node:http"; // guard-allow: egress types only, for the inbound request handler

export declare const handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
