// Headers come from middleware: Astro's own CSP is a <meta> tag, which cannot carry frame-ancestors.
import { defineMiddleware } from "astro:middleware";

const origin = () => `http://localhost:${process.env.PORT ?? 4321}`;
const base = (assets: string) =>
  [
    "default-src 'none'",
    `style-src ${assets}`,
    `font-src ${assets}`,
    "img-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ];

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  // Measurement only: SPIKE_NO_CSP=1 serves without the header, to see whether the islands work at all.
  if (process.env.SPIKE_NO_CSP === "1") return response;
  const assets = `${origin()}/_astro/`;
  const path = context.url.pathname;
  const zeroJs = path.startsWith("/@") || path === "/neg";
  const csp = zeroJs ? base(assets) : [...base(assets), `script-src ${assets}`, "connect-src 'self'"];
  response.headers.set("content-security-policy", csp.join("; "));
  return response;
});
