// The kit showcase (P1.24, P1.24s; book P1.24 "Where"): every built component in each variant and state, server-rendered
// with no JS. P1.26's test server serves it for the axe and target-size checks in both themes; no app links it.
import type { ReactNode } from "react";
import { Avatar } from "../components/Avatar/Avatar.tsx";
import { Button } from "../components/Button/Button.tsx";
import { Checkbox } from "../components/Checkbox/Checkbox.tsx";
import { DescriptionList } from "../components/DescriptionList/DescriptionList.tsx";
import { Icon } from "../components/Icon/Icon.tsx";
import { Input } from "../components/Input/Input.tsx";
import { Kbd } from "../components/Kbd/Kbd.tsx";
import { Link } from "../components/Link/Link.tsx";
import { Mark } from "../components/Mark/Mark.tsx";
import { MediaFrame } from "../components/MediaFrame/MediaFrame.tsx";
import { Pagination } from "../components/Pagination/Pagination.tsx";
import { RadioGroup } from "../components/RadioGroup/RadioGroup.tsx";
import { SectionHeading } from "../components/SectionHeading/SectionHeading.tsx";
import { Select } from "../components/Select/Select.tsx";
import { SkipLink } from "../components/SkipLink/SkipLink.tsx";
import { Switch } from "../components/Switch/Switch.tsx";
import { Tag } from "../components/Tag/Tag.tsx";
import { Textarea } from "../components/Textarea/Textarea.tsx";
import { type SafeHref, safeHref } from "../safe-href.ts";

const href = (raw: string) => safeHref(raw, ["https:", "path"]) as SafeHref;
const languages = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
];

/** One sample per built component, keyed by its inventory name. */
export const SAMPLES: Readonly<Record<string, ReactNode>> = {
  Button: (
    <>
      <Button>Save</Button>{" "}
      <Button type="submit" next>
        Continue
      </Button>{" "}
      <Button disabled>Save</Button>{" "}
      <Button as="a" href={href("/settings")}>
        Settings
      </Button>{" "}
      <Button as="a" href={null}>
        Unavailable
      </Button>
    </>
  ),
  Link: (
    <p>
      Read <Link href={href("/about")}>about unset.sh</Link> or the{" "}
      <Link href={href("https://atproto.com/specs")}>protocol specs</Link>.{" "}
      <Link href={href("/docs")} variant="standalone">
        Read the docs
      </Link>{" "}
      <Link href={href("https://atproto.com/")} variant="standalone">
        AT Protocol
      </Link>
    </p>
  ),
  Tag: (
    <p>
      <Tag status="ok" /> <Tag status="err" /> <Tag status="info" /> <Tag>v0.3.1</Tag>
    </p>
  ),
  Mark: <Mark />,
  SectionHeading: <SectionHeading index="01" title="Profile" />,
  Kbd: (
    <p>
      <Kbd>⌘</Kbd> <Kbd>K</Kbd>
    </p>
  ),
  Icon: (
    <p>
      <Icon name="like" label="Like" /> <Icon name="settings" size={24} label="Settings" />
    </p>
  ),
  Input: (
    <>
      <Input name="handle" label="Handle" placeholder="alice.example" hint="your domain or unset.ac name" />
      <Input name="email" type="email" label="Email" error="not an email address" />
      <Input name="off" label="Disabled" disabled />
    </>
  ),
  Textarea: <Textarea name="bio" label="Bio" hint="shown on your profile" />,
  Checkbox: (
    <>
      <Checkbox name="notify" label="email me about replies" defaultChecked />
      <Checkbox name="digest" label="weekly digest" />
      <Checkbox name="off" label="unavailable" disabled />
    </>
  ),
  RadioGroup: (
    <RadioGroup
      name="theme"
      label="Theme"
      options={[
        { value: "system", label: "system" },
        { value: "dark", label: "dark" },
        { value: "light", label: "light" },
      ]}
      defaultValue="system"
    />
  ),
  Select: <Select name="lang" label="Language" options={languages} placeholder="pick one" />,
  Avatar: (
    <p>
      <Avatar name="alex" size={24} /> <Avatar name="alex" /> <Avatar name="alex" size={64} alt="Alex" />{" "}
      <Avatar name="alex" size={128} />
    </p>
  ),
  Switch: (
    <>
      <Switch name="showEmail" label="show my email" defaultChecked />
      <Switch name="private" label="private profile" />
      <Switch name="locked" label="unavailable" disabled />
    </>
  ),
  SkipLink: <SkipLink shown />,
  MediaFrame: (
    <>
      <MediaFrame alt="" ratio="3:1" caption="profile cover" />
      <MediaFrame alt="" ratio="9:16" emptyText="[no cover]" />
    </>
  ),
  DescriptionList: (
    <DescriptionList
      items={[
        { label: "Handle", value: "alex.example" },
        { label: "DID", value: "did:plc:ewvi7nxzyoun6zhxrhs64oiz", mono: true },
        { label: "Joined", value: null },
      ]}
    />
  ),
  Pagination: (
    <>
      <Pagination page={5} pages={12} hrefFor={(n) => href(`/kit?page=${n}`)} />
      <Pagination label="Followers" newer={null} older={href("/kit?cursor=next")} />
    </>
  ),
};

export function Showcase() {
  return (
    <main id="main">
      <h1>Kit</h1>
      {Object.entries(SAMPLES).map(([name, sample]) => (
        <section key={name} aria-labelledby={`kit-${name}`}>
          <h2 id={`kit-${name}`}>{name}</h2>
          {sample}
        </section>
      ))}
    </main>
  );
}
