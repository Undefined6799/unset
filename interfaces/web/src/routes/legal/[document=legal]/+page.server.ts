// GET /legal/terms, /legal/privacy and /legal/domains (P2.15; P1.20d): the document in apps/web/legal parsed once at
// load (lib/server/legal-markdown.ts refuses raw HTML and keeps only links safeHref accepts), with its {{holes}}
// filled from config here as plain text the page escapes. In the core shell like every app page (P1.20k), so a member
// sees the same header here: a visitor's copy may be kept five minutes, a member's is private and never stored
// (hooks.server.ts). Kept out of search results. `?lang=` is ignored: English only until i18n.
import type { ServerLoad } from "@sveltejs/kit";
import domains from "../../../../../../apps/web/legal/domains.en.md?raw";
import privacy from "../../../../../../apps/web/legal/privacy.en.md?raw";
import terms from "../../../../../../apps/web/legal/terms.en.md?raw";
import type { Run, Section } from "../../../lib/legal.ts";
import { type Block, type Inline, type LegalValues, parseLegal } from "../../../lib/server/legal-markdown.ts";
import { config } from "../../../lib/server/runtime.ts";
import { PUBLIC_PAGE_CACHE, type ShellData } from "../../../lib/shell.ts";

type Document = "terms" | "privacy" | "domains";
const DOCUMENTS = { terms: parseLegal(terms), privacy: parseLegal(privacy), domains: parseLegal(domains) };

const TITLES = { terms: "Terms of service", privacy: "Privacy notice", domains: "Our domains" } as const;
const SHELL: ShellData = { kind: "core", noindex: true };

const fill = (inlines: readonly Inline[], values: LegalValues): Run[] =>
  inlines.map((inline): Run => {
    if (inline.kind === "hole") return { kind: "text", text: values[inline.name] };
    if (inline.kind === "text") return { kind: "text", text: inline.text };
    if (inline.kind === "strong") return { kind: "strong", children: fill(inline.children, values) };
    return { kind: "link", href: inline.href, children: fill(inline.children, values) };
  });

function section(block: Block, values: LegalValues): Section {
  const runs = (inlines: readonly Inline[]) => fill(inlines, values);
  if (block.kind === "h") return { kind: "h", level: block.level, runs: runs(block.children) };
  if (block.kind === "p") return { kind: "p", runs: runs(block.children) };
  if (block.kind === "ul") return { kind: "ul", items: block.items.map(runs) };
  return { kind: "table", headers: block.headers.map(runs), rows: block.rows.map((row) => row.map(runs)) };
}

export const load: ServerLoad = ({ params, setHeaders }) => {
  // The route's matcher (src/params.ts) admits only these three names.
  const name = params.document as Document;
  const values: LegalValues = {
    privacyOfficerTitle: config.PRIVACY_OFFICER_TITLE,
    privacyOfficerContact: config.PRIVACY_OFFICER_CONTACT,
    supportEmail: config.SUPPORT_EMAIL,
    pdsHost: config.PDS_HOSTNAME,
  };
  const document = DOCUMENTS[name];
  setHeaders({ "cache-control": PUBLIC_PAGE_CACHE, "x-robots-tag": "noindex" });
  return {
    shell: SHELL,
    title: TITLES[name],
    version: document.version,
    sections: document.blocks.map((block) => section(block, values)),
  };
};
