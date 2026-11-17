// The profile's cards (ADR 0051), rendered from plain view props with no script: every member string escaped by
// React, every address through safeHref.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { type CardView, linkText, ProfileCards } from "./ProfileCards.tsx";

const html = (cards: CardView[]) => renderToStaticMarkup(<ProfileCards cards={cards} />);
const one = (content: CardView["content"], width: CardView["width"] = "full"): CardView[] => [
  { key: "k1", width, content },
];

describe("ProfileCards", () => {
  test("nothing renders when there are no cards", () => {
    expect(html([])).toBe("");
  });

  test("a README card shows its bar and its markdown", () => {
    const out = html(one({ kind: "readme", text: "# Hi\n\nI make **things**." }));
    expect(out).toContain("README.md");
    expect(out).toContain("<h3>Hi</h3>");
    expect(out).toContain("<strong>things</strong>");
  });

  test("a links card shows each link with its label, or the address when it has none", () => {
    const out = html(
      one({
        kind: "links",
        title: "Elsewhere",
        layout: "grid",
        items: [
          { uri: "https://github.com/alice", label: "", description: "Code" },
          { uri: "https://alice.blog/", label: "Blog", description: "" },
        ],
      }),
    );
    expect(out).toContain("<h2");
    expect(out).toContain("Elsewhere");
    expect(out).toContain('href="https://github.com/alice"');
    expect(out).toContain("github.com/alice");
    expect(out).toContain(">Blog<");
    expect(out).toContain("Code");
    expect(out).toMatch(/rel="me noopener noreferrer"/);
  });

  test("a collection shows entries, with a link only when the entry has an address", () => {
    const out = html(
      one({
        kind: "collection",
        title: "",
        layout: "carousel",
        items: [
          { title: "unset.sh", tag: "Project", description: "A profile app", uri: "https://unset.sh" },
          { title: "Notes", tag: "", description: "", uri: "" },
        ],
      }),
    );
    expect(out).toContain('href="https://unset.sh/"');
    expect(out).toContain("Project");
    expect(out).toContain("A profile app");
    expect((out.match(/<a /g) ?? []).length).toBe(1);
  });

  test("buttons word themselves from the preset, and email opens an encoded mailto link", () => {
    const out = html(
      one({
        kind: "buttons",
        heading: "Work with me",
        text: "Open to contracts.",
        buttons: [
          { kind: "email", address: "a.b+c@x.example" },
          { kind: "link", preset: "bookCall", uri: "https://cal.example/a", label: "" },
          { kind: "link", preset: "custom", uri: "https://x.example", label: "Tip jar" },
          { kind: "link", preset: "custom", uri: "https://y.example", label: "" },
        ],
      }),
    );
    expect(out).toContain('href="mailto:a.b%2Bc%40x.example"');
    expect(out).toContain("Email me");
    expect(out).toContain("Book a call");
    expect(out).toContain("Tip jar");
    expect(out).toContain("Open link");
  });

  test("a half-width card says so for the grid", () => {
    expect(html(one({ kind: "readme", text: "x" }, "half"))).toContain('data-width="half"');
  });

  test.each(["javascript:alert(1)", "data:text/html,x", "//evil.example", "https://user:pw@evil.example"])(
    "an unsafe address renders no link even if one reaches the view: %s",
    (uri) => {
      const out = html([
        {
          key: "a",
          width: "full",
          content: { kind: "links", title: "", layout: "list", items: [{ uri, label: "x", description: "" }] },
        },
        {
          key: "b",
          width: "full",
          content: {
            kind: "collection",
            title: "",
            layout: "list",
            items: [{ title: "t", tag: "", description: "", uri }],
          },
        },
        {
          key: "c",
          width: "full",
          content: {
            kind: "buttons",
            heading: "h",
            text: "",
            buttons: [{ kind: "link", preset: "hire", uri, label: "" }],
          },
        },
      ]);
      expect(out).not.toContain(uri.replace(/&/g, "&amp;"));
      expect(out).not.toMatch(/href="(?!https?:\/\/)/);
    },
  );

  test("member text is escaped", () => {
    const out = html(
      one({
        kind: "collection",
        title: "<script>x</script>",
        layout: "list",
        items: [{ title: "<b>", tag: "", description: "", uri: "" }],
      }),
    );
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;b&gt;");
  });
});

describe("linkText", () => {
  test.each([
    ["https://github.com/alice", "github.com/alice"],
    ["https://www.example.com/", "example.com"],
    ["https://x.example/a/b/?q=1#f", "x.example/a/b"],
  ])("%s reads as %s", (uri, text) => {
    expect(linkText(uri)).toBe(text);
  });
});
