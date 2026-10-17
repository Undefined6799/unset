// P2.15: the English legal documents contain every checklist marker, and the renderer escapes text.
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LEGAL_DOCUMENTS } from "./documents.ts";
import { changelogProblem, type LegalValues, missingMarkers, parseLegal } from "./markdown.ts";
import { renderLegal } from "./render.tsx";

const VALUES: LegalValues = {
  privacyOfficerTitle: "Officer",
  privacyOfficerContact: "contact",
  supportEmail: "support",
  pdsHost: "pds.example",
};

const TERMS = [
  ["T1", "invite-only"],
  ["T1", "16 or older"],
  ["T1", "European Union"],
  ["T2", "private until you publish"],
  ["T2", "may not be recallable"],
  ["T3", "fingerprinted"],
  ["T3", "Canadian Centre for Child Protection"],
  ["T3", "stand-in"],
  ["T4", "When posting opens"],
  ["T5", "Acceptable use"],
  ["T6", "suspend"],
  ["T6", "automated check"],
  ["T7", "When chat opens"],
  ["T8", "Contact"],
] as const;

const PRIVACY = [
  ["P1", "section 3.1"],
  ["P1", "{{privacyOfficerTitle}}"],
  ["P2", "never hold your password"],
  ["P3", "do not store IP addresses"],
  ["P3", "From Phase 5"],
  ["P3", "never written"],
  ["P4", "fingerprints only"],
  ["P4", "sends nothing to another company"],
  ["P5", "30 days after your last edit"],
  ["P5", "part of your export"],
  ["P6", "Office of the Privacy Commissioner of Canada"],
  ["P6", "Commission d'accès à l'information"],
  ["P7", "relays"],
  ["P8", "{{supportEmail}}"],
] as const;

describe("legal documents", () => {
  test("legal.items_present", () => {
    const terms = LEGAL_DOCUMENTS.terms.source;
    const privacy = LEGAL_DOCUMENTS.privacy.source;
    const domains = LEGAL_DOCUMENTS.domains.source;
    expect(missingMarkers(terms, ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"])).toEqual([]);
    expect(missingMarkers(privacy, ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"])).toEqual([]);
    expect(missingMarkers(domains, ["DOMAINS"])).toEqual([]);
    for (const [id, phrase] of TERMS) expect(terms, id).toContain(phrase);
    for (const [id, phrase] of PRIVACY) expect(privacy, id).toContain(phrase);
    for (const phrase of [
      "unset.sh is the app",
      "unset.cc is chat",
      "unset.ac",
      "the only place you type your password",
      "unset.im",
      "Its name is not chosen yet",
      "not ours",
      "{{pdsHost}}",
    ]) {
      expect(domains).toContain(phrase);
    }
    expect(domains).not.toContain("chat.unset.sh");
    expect(domains).not.toContain("0x40.me");
    expect(privacy).not.toContain("Anthropic");
    expect(missingMarkers("<!-- T1 -->", ["T1", "T2"])).toEqual(["T2"]);
  });

  test("legal.versions_match_their_changelog", () => {
    for (const document of [LEGAL_DOCUMENTS.terms, LEGAL_DOCUMENTS.privacy]) {
      expect(document.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(changelogProblem(document.source, document.version ?? "")).toBeNull();
    }
    expect(LEGAL_DOCUMENTS.domains.version).toBeNull();
    expect(changelogProblem("# T\n", "2026-10-17")).toBe("no changes section");
    expect(changelogProblem("# T\n\n## Changes\n\n- old\n", "2026-10-17")).toBe("version missing from changes");
  });

  test("legal.renderer_escapes_text_and_refuses_a_bad_link", () => {
    const doc = parseLegal("# Title\n\nSee <b>no</b> and {{privacyOfficerTitle}}.\n");
    const html = renderToString(renderLegal(doc, { ...VALUES, privacyOfficerTitle: "<b>x</b>" }));
    expect(html).toContain("&lt;b&gt;no&lt;/b&gt;");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>");
    expect(() => parseLegal("# T\n\n[x](javascript:alert(1))\n")).toThrow(/link refused/);
    expect(() => parseLegal("# T\n\n{{nope}}\n")).toThrow(/unknown hole/);
  });
});
