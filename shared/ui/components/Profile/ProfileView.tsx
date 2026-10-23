// The profile layout (Alex 2026-10-23; Figma 4hrOlzQ1d0lA8Acm4KyLVf, page Profile, v3 frames 174:1175 and 174:1437):
// GitHub-style, the avatar, name and short facts in a left column and the member's markdown README on the right.
// Shared by the server page and the owner's editing island (ProfileEditor.tsx) so both draw the same markup. The
// copy comes from the app as `labels`, so it travels as island props like the theme picker's labels.
import type { ReactNode } from "react";
import { safeHref } from "../../safe-href.ts";
import { Avatar } from "../Avatar/Avatar.tsx";
import { Markdown } from "../Markdown/Markdown.tsx";
import styles from "./Profile.module.css";

export type ProfileFieldName = "displayName" | "headline" | "location" | "website" | "readme";
export const FIELDS: readonly ProfileFieldName[] = ["displayName", "headline", "location", "website", "readme"];

export type ProfileFieldsView = {
  readonly displayName: string;
  readonly headline: string;
  readonly location: string;
  /** Already checked as a plain http(s) URL by domains/profile; safeHref decides again here before it is a link. */
  readonly website: string;
  readonly readme: string;
};

/** The page's copy (apps/web/src/screens/messages.ts PROFILE, plus the P2.13c set-up card). */
export type ProfileLabels = {
  readonly handleUnavailable: string;
  readonly fields: Readonly<Record<ProfileFieldName, string>>;
  readonly add: Readonly<Record<ProfileFieldName, string>>;
  readonly edit: string;
  readonly done: string;
  readonly cancel: string;
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
  "edit",
  "done",
  "cancel",
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
  strings(value.failed, ["conflict", "invalid", "unavailable", "other"]);

// `field` wraps each editable field: the page shows it as it is, the island adds the pencil and the editor. A field
// passed as null is empty.
export type FieldSlot = (name: ProfileFieldName, content: ReactNode | null) => ReactNode;
const asIs: FieldSlot = (_name, content) => content;
/** The website as the member typed it, without the scheme, the way a reader says it. */
function websiteLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

export type ProfileViewProps = {
  readonly handle: string;
  readonly handleUnavailable: boolean;
  readonly fields: ProfileFieldsView;
  readonly labels: ProfileLabels;
  readonly field?: FieldSlot;
  /** What the README column shows when there is no README; the app passes its call to action. */
  readonly emptyReadme?: ReactNode;
};

function Facts({ location, site }: { location: ReactNode | null; site: ReactNode | null }) {
  return location === null && site === null ? null : (
    <ul className={styles.facts}>
      {location === null ? null : <li>{location}</li>}
      {site === null ? null : <li>{site}</li>}
    </ul>
  );
}

export function ProfileView({
  handle,
  handleUnavailable,
  fields,
  labels,
  field = asIs,
  emptyReadme = null,
}: ProfileViewProps) {
  const name = fields.displayName === "" ? handle : fields.displayName;
  const href = fields.website === "" ? null : safeHref(fields.website, ["https:", "http:"]);
  const website =
    href === null ? null : (
      <a href={href} rel="nofollow ugc noopener noreferrer me">
        {websiteLabel(fields.website)}
      </a>
    );
  const location = field("location", fields.location === "" ? null : fields.location);
  const site = field("website", website);
  const headline = field("headline", fields.headline === "" ? null : fields.headline);
  return (
    <div className={styles.profile}>
      <div className={styles.side}>
        <Avatar name={name} size={128} />
        <div className={styles.names}>
          <h1 className={styles.name}>{field("displayName", name)}</h1>
          {name === handle ? null : <p className={styles.handle}>{handle}</p>}
        </div>
        {handleUnavailable ? <p>{labels.handleUnavailable}</p> : null}
        {headline === null ? null : <p className={styles.headline}>{headline}</p>}
        <Facts location={location} site={site} />
      </div>
      <div className={styles.readme}>
        {field("readme", fields.readme === "" ? null : <Markdown source={fields.readme} />) ?? emptyReadme}
      </div>
    </div>
  );
}
