// The profile's cards (ADR 0051), from plain view props: the README, links, a collection of entries and buttons. Pure
// and script-free; every member string is a React child (escaped) and every address goes through safeHref, here too
// although the domain already dropped unsafe ones (two layers for the one output that every visitor sees).
import { Button, Icon, type SafeHref, safeHref } from "@unset/shared-ui";
import { Children, type ReactNode } from "react";
import { CARD_TEXT } from "./messages.ts";
import styles from "./ProfileCards.module.css";
import { Readme } from "./readme.tsx";

export type CardLayout = "list" | "carousel" | "grid";
export type CardLinkView = { readonly uri: string; readonly label: string; readonly description: string };
export type CardEntryView = {
  readonly title: string;
  readonly tag: string;
  readonly description: string;
  readonly uri: string;
};
export type CardButtonView =
  | { readonly kind: "email"; readonly address: string }
  | {
      readonly kind: "link";
      readonly preset: "bookCall" | "hire" | "subscribe" | "custom";
      readonly uri: string;
      readonly label: string;
    };
/** Optional text is "" when unset; the shape the profile domain reads a card into. */
export type CardView = {
  readonly key: string;
  readonly width: "full" | "half";
  readonly content:
    | { readonly kind: "readme"; readonly text: string }
    | {
        readonly kind: "links";
        readonly title: string;
        readonly layout: CardLayout;
        readonly items: readonly CardLinkView[];
      }
    | {
        readonly kind: "collection";
        readonly title: string;
        readonly layout: CardLayout;
        readonly items: readonly CardEntryView[];
      }
    | {
        readonly kind: "buttons";
        readonly heading: string;
        readonly text: string;
        readonly buttons: readonly CardButtonView[];
      };
};

const web = (uri: string) => (uri === "" ? null : safeHref(uri, ["http:", "https:"]));

/** How an address reads when the member gave it no label: host without www, then the path, no query or hash. */
export function linkText(uri: string): string {
  try {
    const url = new URL(uri);
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return uri;
  }
}

function LinkItem({ link, href }: { readonly link: CardLinkView; readonly href: SafeHref }) {
  return (
    <li className={styles.item}>
      <a className={styles.link} href={href} rel="me noopener noreferrer">
        <span className={styles.linkText}>{link.label === "" ? linkText(link.uri) : link.label}</span>
        <Icon name="external" size={16} />
      </a>
      {link.description === "" ? null : <p className={styles.muted}>{link.description}</p>}
    </li>
  );
}

function Entry({ entry }: { readonly entry: CardEntryView }) {
  const href = web(entry.uri);
  return (
    <li className={styles.item}>
      {entry.tag === "" ? null : <span className={styles.tag}>{entry.tag}</span>}
      <h3 className={styles.entryTitle}>
        {href === null ? (
          entry.title
        ) : (
          <a className={styles.link} href={href} rel="noopener noreferrer">
            {entry.title}
          </a>
        )}
      </h3>
      {entry.description === "" ? null : <p className={styles.muted}>{entry.description}</p>}
    </li>
  );
}

function buttonOf(button: CardButtonView): { readonly href: SafeHref | null; readonly label: string } {
  if (button.kind === "email") {
    // Percent-encoded (RFC 6068 section 2): the address can only ever be the recipient, never add headers.
    return { href: safeHref(`mailto:${encodeURIComponent(button.address)}`, ["mailto:"]), label: CARD_TEXT.email };
  }
  const label = button.preset === "custom" ? button.label || CARD_TEXT.custom : CARD_TEXT[button.preset];
  return { href: web(button.uri), label };
}

function Buttons({ buttons }: { readonly buttons: readonly CardButtonView[] }) {
  const shown = buttons.map(buttonOf).filter((b): b is { href: SafeHref; label: string } => b.href !== null);
  return (
    <div className={styles.buttons}>
      {shown.map((b, i) => (
        <Button key={`${b.label}:${b.href}`} as="a" href={b.href} variant={i === 0 ? "solid" : "standalone"}>
          {b.label}
        </Button>
      ))}
    </div>
  );
}

// Children.toArray keys each list by position: the page is rendered on the server and never reordered in place.
const keyed = (nodes: readonly ReactNode[]) => Children.toArray(nodes);
const linkItem = (link: CardLinkView) => {
  const href = web(link.uri);
  return href === null ? null : <LinkItem link={link} href={href} />;
};
const entryItem = (entry: CardEntryView) => <Entry entry={entry} />;

function CardBody({ content }: { readonly content: CardView["content"] }) {
  switch (content.kind) {
    case "readme":
      return (
        <>
          <div className={styles.bar}>README.md</div>
          <div className={styles.readme}>
            <Readme text={content.text} />
          </div>
        </>
      );
    case "links":
    case "collection":
      return (
        <>
          {content.title === "" ? null : <h2 className={styles.title}>{content.title}</h2>}
          <ul className={styles[content.layout]}>
            {content.kind === "links" ? keyed(content.items.map(linkItem)) : keyed(content.items.map(entryItem))}
          </ul>
        </>
      );
    case "buttons":
      return (
        <>
          <h2 className={styles.title}>{content.heading}</h2>
          {content.text === "" ? null : <p className={styles.muted}>{content.text}</p>}
          <Buttons buttons={content.buttons} />
        </>
      );
  }
}

/** The cards in page order. An empty list renders nothing. */
export function ProfileCards({ cards }: { readonly cards: readonly CardView[] }) {
  if (cards.length === 0) return null;
  return (
    <div className={styles.cards}>
      {cards.map((card) => (
        <section key={card.key} className={styles.card} data-width={card.width}>
          <CardBody content={card.content} />
        </section>
      ))}
    </div>
  );
}
