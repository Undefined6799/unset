// Readme: renders a member's README blocks (the sh.unset.profile lexicon's block model, P2.20w) as plain elements on
// the server, with no script. Every text node is a React child, so React escapes it; nothing here builds an HTML string.
// A link is kept only when safeHref accepts it as http(s), and says it is user content (rel per book P2.20 step 2).
// The page's h1 is the member's name, so README headings 1-3 render as h2-h4. Columns sit side by side and stack on
// narrow screens (Readme.module.css). The props mirror the lexicon's shapes; this kit component knows no product rules.
// biome-ignore-all lint/suspicious/noArrayIndexKey: the README is rendered whole on the server, never reordered
import type { ReactNode } from "react";
import { safeHref } from "../../safe-href.ts";
import styles from "./Readme.module.css";

const D = "sh.unset.profile#";
export type ReadmeTextRun = {
  readonly $type: `${typeof D}textRun`;
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly code?: boolean;
};
export type ReadmeRun =
  | ReadmeTextRun
  | { readonly $type: `${typeof D}linkRun`; readonly uri: string; readonly content: readonly ReadmeTextRun[] };
export type ReadmeListItem = {
  readonly $type: `${typeof D}listItem`;
  readonly style: string;
  readonly indent?: number;
  readonly checked?: boolean;
  readonly align?: string;
  readonly content: readonly ReadmeRun[];
};
export type ReadmeBlockData =
  | {
      readonly $type: `${typeof D}paragraph` | `${typeof D}display` | `${typeof D}quote`;
      readonly align?: string;
      readonly content: readonly ReadmeRun[];
    }
  | {
      readonly $type: `${typeof D}heading`;
      readonly level: number;
      readonly align?: string;
      readonly content: readonly ReadmeRun[];
    }
  | ReadmeListItem
  | { readonly $type: `${typeof D}codeBlock`; readonly text: string; readonly language?: string };
export type ReadmeColumns = {
  readonly $type: `${typeof D}columns`;
  readonly columns: readonly { readonly blocks: readonly ReadmeBlockData[] }[];
};

export type ReadmeProps = {
  blocks: readonly (ReadmeBlockData | ReadmeColumns)[];
  /** Words a screen reader hears for a check item. */
  labels: { done: string; notDone: string };
};

function textRun(run: ReadmeTextRun, key: number): ReactNode {
  let node: ReactNode = run.code ? <code key={key}>{run.text}</code> : run.text;
  if (run.bold) node = <strong key={key}>{node}</strong>;
  if (run.italic) node = <em key={key}>{node}</em>;
  if (run.underline) node = <u key={key}>{node}</u>;
  if (run.strike) node = <s key={key}>{node}</s>;
  return node;
}

function runs(content: readonly ReadmeRun[]): ReactNode[] {
  return content.map((run, index) => {
    if (run.$type === `${D}textRun`) return textRun(run, index);
    const text = run.content.map(textRun);
    const href = safeHref(run.uri, ["http:", "https:"]);
    return href === null ? (
      text
    ) : (
      <a key={index} href={href} rel="nofollow ugc noopener noreferrer">
        {text}
      </a>
    );
  });
}

/** A block's alignment as a data attribute the stylesheet reads; only centre and right are drawn, anything else reads
 * as the start of the line. */
function aligned(align: string | undefined): { "data-align"?: "center" | "right" } {
  return align === "center" || align === "right" ? { "data-align": align } : {};
}

type ListNode = { item: ReadmeListItem; children: ListNode[] };

/** List items in reading order as a tree: an item one indent deeper than the one before it nests inside it. */
function listTree(items: readonly ReadmeListItem[]): ListNode[] {
  const roots: ListNode[] = [];
  const open: ListNode[] = [];
  for (const item of items) {
    const node = { item, children: [] };
    const depth = Math.min(item.indent ?? 0, open.length);
    open.length = depth;
    (depth === 0 ? roots : (open[depth - 1] as ListNode).children).push(node);
    open.push(node);
  }
  return roots;
}

function checkMark(checked: boolean | undefined, labels: ReadmeProps["labels"]): ReactNode[] {
  return [
    <span key="mark" className={styles.check} aria-hidden="true">
      {checked ? "[×]" : "[ ]"}
    </span>,
    <span key="state" className="visually-hidden">
      {checked ? labels.done : labels.notDone}
    </span>,
  ];
}

function listItem(node: ListNode, key: number, labels: ReadmeProps["labels"]): ReactNode {
  return (
    <li key={key} {...aligned(node.item.align)}>
      {node.item.style === "check" ? checkMark(node.item.checked, labels) : null}
      {runs(node.item.content)}
      {node.children.length > 0 ? lists(node.children, labels) : null}
    </li>
  );
}

/** Sibling items: consecutive ones of one style form one list; an unknown style reads as bullet. */
function lists(nodes: readonly ListNode[], labels: ReadmeProps["labels"]): ReactNode[] {
  const groups: ListNode[][] = [];
  for (const node of nodes) {
    const last = groups.at(-1);
    if (last?.[0]?.item.style === node.item.style) last.push(node);
    else groups.push([node]);
  }
  return groups.map((group, index) => {
    const style = group[0]?.item.style;
    const items = group.map((node, itemIndex) => listItem(node, itemIndex, labels));
    if (style === "numbered") return <ol key={index}>{items}</ol>;
    return (
      <ul key={index} className={style === "check" ? styles.checks : undefined}>
        {items}
      </ul>
    );
  });
}

function block(node: Exclude<ReadmeBlockData, ReadmeListItem>, key: number): ReactNode {
  switch (node.$type) {
    case `${D}paragraph`:
      return (
        <p key={key} {...aligned(node.align)}>
          {runs(node.content)}
        </p>
      );
    case `${D}display`:
      // The sheet's display style (Alex 2026-10-24 00:08Z), as large text, not a heading: the page's outline stays
      // the README's headings.
      return (
        <p key={key} className={styles.display} {...aligned(node.align)}>
          {runs(node.content)}
        </p>
      );
    case `${D}quote`:
      return (
        <blockquote key={key}>
          <p>{runs(node.content)}</p>
        </blockquote>
      );
    case `${D}heading`: {
      const Heading = node.level <= 1 ? "h2" : node.level === 2 ? "h3" : "h4";
      return (
        <Heading key={key} {...aligned(node.align)}>
          {runs(node.content)}
        </Heading>
      );
    }
    case `${D}codeBlock`:
      return (
        <pre key={key} className={styles.code}>
          <code>{node.text}</code>
        </pre>
      );
    default:
      return null;
  }
}

/** Blocks in reading order; consecutive list items become one list. */
function flow(blocks: readonly ReadmeBlockData[], labels: ReadmeProps["labels"]): ReactNode[] {
  const out: ReactNode[] = [];
  let pending: ReadmeListItem[] = [];
  const flush = () => {
    if (pending.length > 0) out.push(...lists(listTree(pending), labels));
    pending = [];
  };
  blocks.forEach((node, index) => {
    if (node.$type === `${D}listItem`) pending.push(node);
    else {
      flush();
      out.push(block(node, index));
    }
  });
  flush();
  return out;
}

export function Readme({ blocks, labels }: ReadmeProps) {
  if (blocks.length === 0) return null;
  const sections: ReactNode[] = [];
  let run: ReadmeBlockData[] = [];
  const flushRun = () => {
    if (run.length > 0) sections.push(<div key={sections.length}>{flow(run, labels)}</div>);
    run = [];
  };
  for (const node of blocks) {
    if (node.$type !== `${D}columns`) {
      run.push(node);
      continue;
    }
    flushRun();
    sections.push(
      <div key={sections.length} className={styles.columns} data-columns={node.columns.length}>
        {node.columns.map((column, index) => (
          <div key={index}>{flow(column.blocks, labels)}</div>
        ))}
      </div>,
    );
  }
  flushRun();
  return <div className={styles.root}>{sections}</div>;
}
