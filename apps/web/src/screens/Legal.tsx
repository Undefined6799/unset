// The two legal pages' slots (P1.25): a placeholder at each path until the legal work (P2.15) writes the texts.
import { LEGAL } from "../shell/messages.ts";

export type LegalProps = { document: "terms" | "privacy" };

export function Legal({ document }: LegalProps) {
  return (
    <>
      <h1>{LEGAL[document]}</h1>
      <p>{LEGAL.preparing}</p>
    </>
  );
}
