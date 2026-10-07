// Table (P1.24a): the sheet's Table (components/Table/README.md, index.d.ts) as built. Differences from the sheet's
// d.ts: `caption` is required (book P1.24a), and the scrolling wrapper is a focusable <section> (a region) named by the caption.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tag } from "../Tag/Tag.tsx";
import styles from "./Table.module.css";
import { Table, type TableColumn } from "./Table.tsx";

const columns: TableColumn[] = [
  { key: "name", label: "Service", mono: false },
  { key: "state", label: "State" },
  { key: "ms", label: "Latency", align: "right", muted: true },
];

describe("Table", () => {
  it("table_caption_scope_and_empty_dash", () => {
    const html = renderToStaticMarkup(
      <Table
        caption="Services"
        columns={columns}
        rows={[{ name: "PDS", state: <Tag status="ok">live</Tag>, ms: "" }]}
      />,
    );
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(id).not.toBe("");
    expect(html).toBe(
      `<section class="${styles.wrap}" aria-labelledby="${id}" tabindex="0"><table class="${styles.table}">` +
        `<caption id="${id}" class="${styles.caption}">Services</caption><thead><tr>` +
        `<th scope="col">Service</th><th scope="col">State</th><th scope="col" class="${styles.right}">Latency</th>` +
        `</tr></thead><tbody><tr><td>PDS</td><td class="${styles.mono}">${renderToStaticMarkup(<Tag status="ok">live</Tag>)}</td>` +
        `<td class="${styles.mono} ${styles.muted} ${styles.right}">—</td></tr></tbody></table></section>`,
    );
  });

  it("table_without_caption_is_type_error", () => {
    // @ts-expect-error: a table with no caption is a type error.
    expect(renderToStaticMarkup(<Table columns={columns} rows={[]} />)).toContain("<caption");
  });
});
