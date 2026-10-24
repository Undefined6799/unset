// The profile layout (Alex 2026-10-23; Figma 4hrOlzQ1d0lA8Acm4KyLVf, page Profile, v3 frames 174:1175 and 174:1437):
// GitHub-style, the avatar, name and short facts in a left column and the member's markdown README on the right. The
// column follows Alex's 04:04Z mock: the avatar fills it, then name, @handle with [ VERIFIED ], headline, Copy link,
// and a details list. Name, headline, place, website and README are the member's; handle, tag and DID are not.
// The owner's page draws the README inside its form (ReadmeForm.tsx), which the editor chunk opens in place. The copy
// comes from the app as `labels`.
import { IslandSlot } from "@unset/shared-islands";
import type { ReactNode } from "react";
import external from "../../icons/drawings/external.generated.ts";
import shareIsland from "../../islands/share.island.tsx";
import { safeHref } from "../../safe-href.ts";
import { classNames } from "../../src/class-names.ts";
import { Avatar } from "../Avatar/Avatar.tsx";
import { type DescriptionItem, DescriptionList } from "../DescriptionList/DescriptionList.tsx";
import { IconDrawing } from "../Icon/Icon.tsx";
import { Readme, type ReadmeProps } from "../Readme/Readme.tsx";
import { Tag } from "../Tag/Tag.tsx";
import styles from "./Profile.module.css";
import { ReadmeForm, type ReadmeFormLabels } from "./ReadmeForm.tsx";

export type ProfileFieldName = "displayName" | "headline" | "location" | "website" | "readme" | "links";
export const FIELDS: readonly ProfileFieldName[] = [
  "displayName",
  "headline",
  "location",
  "website",
  "readme",
  "links",
];

export type ProfileFieldsView = {
  readonly displayName: string;
  readonly headline: string;
  readonly location: string;
  /** Already checked as a plain http(s) URL by domains/profile; safeHref decides again here before it is a link. */
  readonly website: string;
  /** The README's blocks as the record stores them (domains/profile readStoredReadme). */
  readonly readme: ReadmeProps["blocks"];
  /** One http(s) URL a line (domains/profile); each is a link through safeHref. */
  readonly links: string;
};

/** The page's copy (apps/web/src/screens/messages.ts PROFILE, plus the P2.13c set-up card). */
export type ProfileLabels = {
  readonly handleUnavailable: string;
  readonly verified: string;
  /** What a screen reader hears for a ticked and an unticked check item in the README. */
  readonly checkItem: ReadmeProps["labels"];
  readonly details: Readonly<Record<"location" | "website" | "did", string>>;
  readonly copyLink: string;
  /** The Share button's accessible name. */
  readonly share: string;
  readonly copied: string;
  readonly copyFailed: string;
  readonly fields: Readonly<Record<ProfileFieldName, string>>;
  readonly add: Readonly<Record<ProfileFieldName, string>>;
  readonly edit: string;
  readonly draft: string;
  readonly draftBody: string;
  readonly revert: string;
  readonly undo: string;
  readonly redo: string;
  readonly undoKeys: string;
  readonly redoKeys: string;
  readonly viewAs: string;
  readonly publish: string;
  readonly saving: string;
  readonly saved: string;
  readonly failed: Readonly<Record<"conflict" | "invalid" | "unavailable" | "other", string>>;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const strings = (value: unknown, keys: readonly string[]) =>
  isRecord(value) && keys.every((key) => typeof value[key] === "string");
const LABEL_STRINGS = [
  "handleUnavailable",
  "verified",
  "copyLink",
  "share",
  "copied",
  "copyFailed",
  "edit",
  "draft",
  "draftBody",
  "revert",
  "undo",
  "redo",
  "undoKeys",
  "redoKeys",
  "viewAs",
  "publish",
  "saving",
  "saved",
];

export const isLabels = (value: unknown): value is ProfileLabels =>
  isRecord(value) &&
  strings(value, LABEL_STRINGS) &&
  strings(value.fields, FIELDS) &&
  strings(value.add, FIELDS) &&
  strings(value.details, ["location", "website", "did"]) &&
  strings(value.failed, ["conflict", "invalid", "unavailable", "other"]);

// `field` wraps each editable field: the page shows it as it is, the island adds the pencil and the editor. A field
// passed as null is empty.
export type FieldSlot = (name: ProfileFieldName, content: ReactNode | null) => ReactNode;
const asIs: FieldSlot = (_name, content) => content;
/** The website as the member typed it, without the scheme, the way a reader says it. */
function websiteLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** One of the member's links, as a reader says it ("github.com/alicem"); null when safeHref refuses it. */
export function LinkItem({ uri }: { uri: string }) {
  const href = safeHref(uri, ["https:", "http:"]);
  return href === null ? null : (
    <a href={href} rel="nofollow ugc noopener noreferrer me">
      <IconDrawing paths={external} size={16} />
      {websiteLabel(uri)}
    </a>
  );
}

function LinkList({ links }: { links: string }) {
  return (
    <ul className={styles.links}>
      {links.split("\n").map((uri) => (
        <li key={uri}>
          <LinkItem uri={uri} />
        </li>
      ))}
    </ul>
  );
}

/** A DID short enough for the column, "did:plc:7f3k…tdc9e"; the whole one is its title. */
function shortDid(did: string): string {
  return did.length <= 24 ? did : `${did.slice(0, 12)}…${did.slice(-5)}`;
}

export type ProfileViewProps = {
  readonly did: string;
  readonly handle: string;
  /** The handle passed the two-way check; false when it failed or could not run. */
  readonly verified: boolean;
  readonly handleUnavailable: boolean;
  readonly fields: ProfileFieldsView;
  readonly labels: ProfileLabels;
  readonly field?: FieldSlot;
  /** The Copy link button; only the island draws one, since copying needs script. */
  readonly copyLink?: ReactNode;
  /** What the README column shows when there is no README; the app passes its call to action. */
  readonly emptyReadme?: ReactNode;
  /**
   * The owner's README editing, in place: the README's form with its pencil, which the editor chunk opens
   * (apps/web src/editor). Absent for a visitor, whose page has no script.
   */
  readonly readmeEditor?: { readonly document: string; readonly labels: ReadmeFormLabels };
};

export function ProfileView({
  did,
  handle,
  verified,
  handleUnavailable,
  fields,
  labels,
  field = asIs,
  copyLink = null,
  emptyReadme = null,
  readmeEditor,
}: ProfileViewProps) {
  const name = fields.displayName === "" ? handle : fields.displayName;
  const href = fields.website === "" ? null : safeHref(fields.website, ["https:", "http:"]);
  const website =
    href === null ? null : (
      <a href={href} rel="nofollow ugc noopener noreferrer me">
        {websiteLabel(fields.website)}
      </a>
    );
  const readme = fields.readme.length === 0 ? null : <Readme blocks={fields.readme} labels={labels.checkItem} />;
  const headline = field("headline", fields.headline === "" ? null : fields.headline);
  // A row whose value is null is left out: an empty field on a visitor's view, never on the owner's (it shows "Add").
  const details: DescriptionItem[] = [
    { label: labels.details.location, value: field("location", fields.location === "" ? null : fields.location) },
    { label: labels.details.website, value: field("website", website) },
    {
      label: labels.details.did,
      value: <span title={did}>{shortDid(did)}</span>,
      mono: true,
    },
  ].filter((item) => item.value !== null);
  return (
    <div className={styles.profile}>
      <div className={styles.side}>
        <Avatar name={name} size={128} className={classNames(styles.avatar)} />
        <div className={styles.names}>
          {/* Only ever the display name (Alex 04:27Z, 04:28Z). With none (a profile not yet published; the lexicon
              requires one), the heading is the "Display name" prompt, so it is never empty. */}
          <h1 className={styles.name}>
            {field("displayName", fields.displayName === "" ? null : fields.displayName) ?? (
              <span className={styles.placeholder}>{labels.add.displayName}</span>
            )}
          </h1>
          <p className={styles.handle}>{`@${handle}`}</p>
          {verified ? <Tag status="ok">{labels.verified}</Tag> : null}
        </div>
        {/* The ways to reach the member (Alex 2026-10-24 00:12Z): Share first; the contact means they turn on follow. */}
        <div className={styles.contacts}>
          <IslandSlot
            name="share"
            island={shareIsland}
            props={{ label: labels.share, copied: labels.copied, copyFailed: labels.copyFailed }}
          />
        </div>
        {handleUnavailable ? <p>{labels.handleUnavailable}</p> : null}
        {headline === null ? null : <p className={styles.headline}>{headline}</p>}
        {copyLink}
        <DescriptionList items={details} className={classNames(styles.details)} />
        {field("links", fields.links === "" ? null : <LinkList links={fields.links} />)}
      </div>
      <div className={styles.readme}>
        {readmeEditor === undefined ? (
          (field("readme", readme) ?? emptyReadme)
        ) : (
          <ReadmeForm document={readmeEditor.document} labels={readmeEditor.labels} placeholder={labels.add.readme}>
            {readme}
          </ReadmeForm>
        )}
      </div>
    </div>
  );
}
