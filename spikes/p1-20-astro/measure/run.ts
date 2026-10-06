import { runChromium } from "../../p1-20-hono/measure/browser.ts";
await runChromium("http://localhost:4321", [
  { path: "/", interact: true },
  { path: "/@demo", interact: false },
  { path: "/neg", interact: false },
], "measure/out/raw/chromium-prod.json");
