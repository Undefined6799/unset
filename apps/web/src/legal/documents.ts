// The English legal documents (P2.15). French files land in the i18n slice. Parsed once at load, not per request.
// Sources read 2026-10-17: Quebec Act respecting the protection of personal information in the private sector,
// CQLR c. P-39.1 s. 3.1 (title and contact published), https://www.legisquebec.gouv.qc.ca/en/document/cs/P-39.1 ;
// OPC "Report a concern", https://www.priv.gc.ca/en/report-a-concern/ ; CAI English pages,
// https://www.cai.gouv.qc.ca/english/ . Domain names follow ADR 0025 (unset.sh, unset.ac, unset.im, unset.cc).
import domains from "../../legal/domains.en.md?raw";
import privacy from "../../legal/privacy.en.md?raw";
import terms from "../../legal/terms.en.md?raw";
import { type LegalDocument, parseLegal } from "./markdown.ts";

export const LEGAL_DOCUMENTS = {
  terms: parseLegal(terms),
  privacy: parseLegal(privacy),
  domains: parseLegal(domains),
} as const satisfies Record<"terms" | "privacy" | "domains", LegalDocument>;
