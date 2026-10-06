// Production server for the measurements: the built app behind the plan's CSP (§5.1, host substituted for
// localhost). The CSP strings are the fixture's harness (P1.08 builds the real one), not glue.
import { Hono } from "hono";
import { createApp } from "./app.tsx";
import { serveBuilt } from "./glue/serve.ts";

const port = Number(process.env.PORT ?? 4173);
const host = `http://localhost:${port}`;
const common = `img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; require-trusted-types-for 'script'; trusted-types 'none'`;
const appCsp = `default-src 'none'; script-src ${host}/assets/; style-src ${host}/assets/; font-src ${host}/assets/; connect-src 'self'; ${common}`;
const zeroJsCsp = `default-src 'none'; style-src ${host}/assets/; font-src ${host}/assets/; ${common}`;

const server = new Hono();
server.use("*", async (c, next) => {
  await next();
  c.header("content-security-policy", c.req.path.startsWith("/@") || c.req.path === "/neg" ? zeroJsCsp : appCsp);
});
serveBuilt(server, createApp({ negativeControl: process.env.SPIKE_TEST === "1" }), port);
