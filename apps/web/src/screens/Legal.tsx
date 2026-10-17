// The legal pages (P2.15): a placeholder banner, then the document parsed at load. Config values are React children.
import { LEGAL_DOCUMENTS } from "../legal/documents.ts";
import type { LegalValues } from "../legal/markdown.ts";
import { renderLegal } from "../legal/render.tsx";
import { LEGAL } from "../shell/messages.ts";

export type LegalProps = {
  document: "terms" | "privacy" | "domains";
  values: LegalValues;
};

export function Legal({ document, values }: LegalProps) {
  return (
    <>
      <p>{LEGAL.banner}</p>
      {renderLegal(LEGAL_DOCUMENTS[document], values)}
    </>
  );
}
