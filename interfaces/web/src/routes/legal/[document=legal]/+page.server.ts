// GET /legal/terms, /legal/privacy and /legal/domains (P2.15; P1.20d): the document parsed once at load
// (apps/web/src/legal/documents.ts, which refuses raw HTML and keeps only links safeHref accepts), with its {{holes}}
// filled from config here as plain text the page escapes. No cookie is read, so a browser may keep it five minutes;
// kept out of search results. `?lang=` is ignored: English only until i18n.
import { LEGAL_DOCUMENTS } from "../../../../../../apps/web/src/legal/documents.ts";
import type { Block, Inline, LegalValues } from "../../../../../../apps/web/src/legal/markdown.ts";
import { config } from "../../../lib/server/runtime.ts";
import { PUBLIC_PAGE_CACHE, type ShellData } from "../../../lib/shell.ts";
import type { PageServerLoad } from "./$types";

const TITLES = { terms: "Terms of service", privacy: "Privacy notice", domains: "Our domains" } as const;
const SHELL: ShellData = { kind: "site", noindex: true };

/** What the page draws: text, bold, a checked link, nested as the document has them. */
export type Run =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Run[] }
  | { kind: "link"; href: string; children: Run[] };
export type Section =
  | { kind: "h"; level: 1 | 2 | 3; runs: Run[] }
  | { kind: "p"; runs: Run[] }
  | { kind: "ul"; items: Run[][] }
  | { kind: "table"; headers: Run[][]; rows: Run[][][] };

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

export const load: PageServerLoad = ({ params, setHeaders }) => {
  const values: LegalValues = {
    privacyOfficerTitle: config.PRIVACY_OFFICER_TITLE,
    privacyOfficerContact: config.PRIVACY_OFFICER_CONTACT,
    supportEmail: config.SUPPORT_EMAIL,
    pdsHost: config.PDS_HOSTNAME,
  };
  const document = LEGAL_DOCUMENTS[params.document];
  setHeaders({ "cache-control": PUBLIC_PAGE_CACHE, "x-robots-tag": "noindex" });
  return {
    shell: SHELL,
    title: TITLES[params.document],
    version: document.version,
    sections: document.blocks.map((block) => section(block, values)),
  };
};
