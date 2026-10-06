// DescriptionList (P1.24s): the sheet's DescriptionList (components/DescriptionList/README.md, v45, index.d.ts) as
// built. Differences from the sheet's d.ts: `label` is a string and doubles as the row key (no `key` prop). The
// wide and narrow layouts are a container query, measured in P1.26's browser harness.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import styles from "./DescriptionList.module.css";
import { DescriptionList } from "./DescriptionList.tsx";

describe("DescriptionList", () => {
  it("descriptionlist_layout", () => {
    const html = renderToStaticMarkup(
      <DescriptionList
        items={[
          { label: "Handle", value: "alex.example" },
          { label: "DID", value: "did:plc:abc", mono: true },
          { label: "Joined", value: null },
        ]}
      />,
    );
    expect(html).toMatch(
      new RegExp(`^<dl class="${styles.root}"><div class="${styles.row}"><dt class="${styles.label}">Handle</dt>`),
    );
    expect(html).toContain(`<dd class="${styles.value} ${styles.mono}">did:plc:abc</dd>`);
    expect(html).toContain(`<dt class="${styles.label}">Joined</dt><dd class="${styles.value}">—</dd>`);
    expect(renderToStaticMarkup(<DescriptionList items={[{ label: "Bio", value: "" }]} />)).toContain(">—</dd>");
  });
});
