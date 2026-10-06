// Dev only: @hono/vite-dev-server loads the app through Vite SSR. The React refresh preamble is served as a file,
// never inline, so the dev page needs no inline script.
import { createApp } from "../app.tsx";

const app = createApp({ negativeControl: true });
app.get("/_dev/refresh-preamble", (c) =>
  c.body(
    [
      'import RefreshRuntime from "/@react-refresh";',
      "RefreshRuntime.injectIntoGlobalHook(window);",
      "window.$RefreshReg$ = () => {};",
      "window.$RefreshSig$ = () => (type) => type;",
      "window.__vite_plugin_react_preamble_installed__ = true;",
    ].join("\n"),
    200,
    { "content-type": "text/javascript" },
  ),
);
export default app;
