// The README card's renderer (ADR 0051): the blocks parse.ts reads from the member's text, written as React children
// (escaped). The parser lives in apps/web/lib/profile/ so the Svelte pages read the same one (P1.20i).
import { Children, type ReactNode } from "react";
import { type Block, type Inline, type ListBlock, type ListItem, parseReadme } from "../../../lib/profile/parse.ts";

export { type Block, type Inline, parseInline, parseReadme } from "../../../lib/profile/parse.ts";

// ---- Rendering ---------------------------------------------------------------------------------------------------

// Children.toArray keys each list by position: the text is rendered once, on the server, and never reordered.
const keyed = (nodes: readonly ReactNode[]) => Children.toArray(nodes);

function inlineNode(node: Inline): ReactNode {
  switch (node.kind) {
    case "text":
      return node.text;
    case "code":
      return <code>{node.text}</code>;
    case "strong":
      return <strong>{renderInline(node.children)}</strong>;
    case "em":
      return <em>{renderInline(node.children)}</em>;
    case "link":
      return (
        <a href={node.href} rel="nofollow ugc noopener noreferrer">
          {renderInline(node.children)}
        </a>
      );
  }
}

const renderInline = (nodes: readonly Inline[]) => keyed(nodes.map(inlineNode));

const listItem = (item: ListItem) => (
  <li>
    {renderInline(item.text)}
    {keyed(item.lists.map(listNode))}
  </li>
);

function listNode(list: ListBlock): ReactNode {
  const List = list.ordered ? "ol" : "ul";
  return <List start={list.start}>{keyed(list.items.map(listItem))}</List>;
}

function blockNode(block: Block): ReactNode {
  switch (block.kind) {
    case "heading": {
      // The card's own title is an h2 (ProfileCards), so README headings start one level below it.
      const Heading = (["h3", "h4", "h5"] as const)[block.level - 1] ?? "h5";
      return <Heading>{renderInline(block.children)}</Heading>;
    }
    case "paragraph":
      return <p>{renderInline(block.children)}</p>;
    case "quote":
      return (
        <blockquote>
          <p>{renderInline(block.children)}</p>
        </blockquote>
      );
    case "list":
      return listNode(block);
    case "code":
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr />;
  }
}

/** The README's blocks, with no wrapper: the card supplies the container and its styles. */
export function Readme({ text }: { readonly text: string }) {
  return <>{keyed(parseReadme(text).map(blockNode))}</>;
}
