// Web's half of the draft previews (book P2.19; ADR 0070 point 5): a short-lived link on the media origin to one of
// the signed-in member's own draft versions. The caller passes the session's DID, never one from the request; the key
// is built here from it, and the domain refuses any shape outside `drafts/<did>/i/<uuid>/<version>`.
import { type DraftUrlKeys, mintDraftPath } from "@unset/domains-content";
import type { Did } from "@unset/domains-identity";

export type DraftLink = (member: Did, imageId: string, version: string) => string;

export function draftLinks(
  keys: DraftUrlKeys,
  mediaOrigin: string,
  nowS: () => number = () => Math.floor(Date.now() / 1000),
): DraftLink {
  return (member, imageId, version) =>
    `${mediaOrigin}${mintDraftPath(keys, `drafts/${member}/i/${imageId}/${version}`, nowS())}`;
}
