// Markdown: renders member-written text in the subset markdown.ts parses. Every text node is a React child, so React
// escapes it; nothing here builds an HTML string. Member links say they are user content and pass no ranking or
// referrer (rel per book P2.20 step 2). Rows of columns become a grid that stacks below 720px (Markdown.module.css).
// biome-ignore-all lint/suspicious/noArrayIndexKey: the parsed document is rebuilt whole on every render
import type { ReactNode } from "react";
import styles from "./Markdown.module.css";
import { type Block, type Inline, parseMarkdown } from "./markdown.ts";

export type MarkdownProps = { source: string };

function inlines(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "strong":
        return <strong key={index}>{inlines(node.children)}</strong>;
      case "em":
        return <em key={index}>{inlines(node.children)}</em>;
      case "code":
        return <code key={index}>{node.text}</code>;
      case "link":
        return (
          <a
            key={index}
            href={node.href}
            rel={node.href.startsWith("/") ? "nofollow ugc" : "nofollow ugc noopener noreferrer"}
          >
            {inlines(node.children)}
          </a>
        );
      default: {
        const never: never = node;
        return never;
      }
    }
  });
}

function lines(rows: readonly (readonly Inline[])[]): ReactNode[] {
  return rows.flatMap((line, index) => (index === 0 ? inlines(line) : [<br key={`br${index}`} />, ...inlines(line)]));
}

function block(node: Block, index: number): ReactNode {
  switch (node.kind) {
    case "h":
      return node.level === 2 ? (
        <h2 key={index}>{inlines(node.children)}</h2>
      ) : (
        <h3 key={index}>{inlines(node.children)}</h3>
      );
    case "p":
      return <p key={index}>{lines(node.lines)}</p>;
    case "quote":
      return (
        <blockquote key={index}>
          <p>{lines(node.lines)}</p>
        </blockquote>
      );
    case "ul":
    case "ol": {
      const items = node.items.map((item, itemIndex) => <li key={itemIndex}>{inlines(item)}</li>);
      return node.kind === "ul" ? <ul key={index}>{items}</ul> : <ol key={index}>{items}</ol>;
    }
    case "code":
      return (
        <pre key={index} className={styles.code}>
          <code>{node.text}</code>
        </pre>
      );
    default: {
      const never: never = node;
      return never;
    }
  }
}

export function Markdown({ source }: MarkdownProps) {
  const { rows } = parseMarkdown(source);
  if (rows.length === 0) return null;
  return (
    <div className={styles.root}>
      {rows.map((row, rowIndex) => [
        rowIndex > 0 ? <hr key={`hr${rowIndex}`} className={styles.rule} /> : null,
        <div key={rowIndex} className={styles.row} data-columns={row.columns.length}>
          {row.columns.map((column, columnIndex) => (
            <div key={columnIndex} className={styles.column}>
              {column.map(block)}
            </div>
          ))}
        </div>,
      ])}
    </div>
  );
}
