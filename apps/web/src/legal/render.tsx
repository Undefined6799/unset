// Renders a parsed legal document (P2.15). Holes become text children, so React escapes the config values.
// Nothing here concatenates a value into an HTML string.
// biome-ignore-all lint/suspicious/noArrayIndexKey: the document is static and its order never changes
import { Link } from "@unset/shared-ui";
import type { ReactNode } from "react";
import type { Block, Inline, LegalDocument, LegalValues } from "./markdown.ts";

function renderInlines(inlines: readonly Inline[], values: LegalValues): ReactNode[] {
  return inlines.map((inline, index) => {
    switch (inline.kind) {
      case "text":
        return inline.text;
      case "strong":
        return <strong key={index}>{renderInlines(inline.children, values)}</strong>;
      case "link":
        return (
          <Link key={index} href={inline.href}>
            {renderInlines(inline.children, values)}
          </Link>
        );
      case "hole":
        return values[inline.name];
      default: {
        const never: never = inline;
        return never;
      }
    }
  });
}

function renderBlock(block: Block, values: LegalValues, index: number): ReactNode {
  switch (block.kind) {
    case "h": {
      const content = renderInlines(block.children, values);
      if (block.level === 1) return <h1 key={index}>{content}</h1>;
      if (block.level === 2) return <h2 key={index}>{content}</h2>;
      return <h3 key={index}>{content}</h3>;
    }
    case "p":
      return <p key={index}>{renderInlines(block.children, values)}</p>;
    case "ul":
      return (
        <ul key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlines(item, values)}</li>
          ))}
        </ul>
      );
    case "table":
      return (
        <table key={index}>
          <thead>
            <tr>
              {block.headers.map((cell, cellIndex) => (
                <th key={cellIndex}>{renderInlines(cell, values)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{renderInlines(cell, values)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    default: {
      const never: never = block;
      return never;
    }
  }
}

export function renderLegal(doc: LegalDocument, values: LegalValues): ReactNode {
  return (
    <>
      {doc.version === null ? null : <p>Version {doc.version}.</p>}
      {doc.blocks.map((block, index) => renderBlock(block, values, index))}
    </>
  );
}
