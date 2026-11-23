// The README parser's images and nested lists (staging walkthrough 2026-11-18, finding 7). The sweep for slow input
// is in parse.adversarial.test.ts.
import { describe, expect, test } from "vitest";
import { parseInline, parseReadme } from "./parse.ts";

const text = (t: string) => ({ kind: "text", text: t });
const item = (t: string, lists: unknown[] = []) => ({ text: [text(t)], lists });

describe("parseReadme", () => {
  test("an image is a link to it with its alt text, without the stray mark", () => {
    expect(parseInline("see ![a cat](https://example.com/cat.png) here")).toEqual([
      text("see "),
      { kind: "link", href: "https://example.com/cat.png", children: [text("a cat")] },
      text(" here"),
    ]);
  });

  test("an image whose address is refused stays text, as a link does", () => {
    expect(parseInline("![x](javascript:alert(1))")).toEqual([text("![x](javascript:alert(1))")]);
  });

  test("an item indented to the text of the one above is its own list, and lists of both kinds nest", () => {
    const src = ["- fruit", "  - apple", "  - pear", "    1. green", "- veg", "   1. leek"].join("\n");
    expect(parseReadme(src)).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          item("fruit", [
            {
              kind: "list",
              ordered: false,
              items: [item("apple"), item("pear", [{ kind: "list", ordered: true, items: [item("green")] }])],
            },
          ]),
          item("veg", [{ kind: "list", ordered: true, items: [item("leek")] }]),
        ],
      },
    ]);
  });

  test("an item indented less than the text above is a sibling, and past three levels lists stop nesting", () => {
    expect(parseReadme("- a\n - b")).toEqual([{ kind: "list", ordered: false, items: [item("a"), item("b")] }]);
    const deep = ["- 1", "  - 2", "    - 3", "      - 4"].join("\n");
    const third = { kind: "list", ordered: false, items: [item("3"), item("4")] };
    expect(parseReadme(deep)).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [item("1", [{ kind: "list", ordered: false, items: [item("2", [third])] }])],
      },
    ]);
  });
});

describe("parseReadme, the CommonMark subset (moved from the React card's test, P1.20k)", () => {
  test("headings, paragraphs, lists, quotes, code and rules", () => {
    const src = [
      "# Hello",
      "",
      "I build **small** tools and *write* about them.",
      "Second line.",
      "",
      "- one",
      "* two",
      "",
      "1. first",
      "2. second",
      "",
      "> quoted",
      "",
      "```",
      "<b>raw</b>",
      "```",
      "",
      "---",
    ].join("\n");
    expect(parseReadme(src)).toEqual([
      { kind: "heading", level: 1, children: [{ kind: "text", text: "Hello" }] },
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "I build " },
          { kind: "strong", children: [{ kind: "text", text: "small" }] },
          { kind: "text", text: " tools and " },
          { kind: "em", children: [{ kind: "text", text: "write" }] },
          { kind: "text", text: " about them. Second line." },
        ],
      },
      {
        kind: "list",
        ordered: false,
        items: [
          { text: [{ kind: "text", text: "one" }], lists: [] },
          { text: [{ kind: "text", text: "two" }], lists: [] },
        ],
      },
      {
        kind: "list",
        ordered: true,
        items: [
          { text: [{ kind: "text", text: "first" }], lists: [] },
          { text: [{ kind: "text", text: "second" }], lists: [] },
        ],
      },
      { kind: "quote", paragraphs: [[{ kind: "text", text: "quoted" }]] },
      { kind: "code", text: "<b>raw</b>" },
      { kind: "rule" },
    ]);
  });

  // Codex review of #1827: remark writes a literal bracket in link text as "\\[", which is text, not a nested label.
  // Codex review of #1827: an escaped "]" in a label does not end it, so the link's address is still shielded from the
  // emphasis around it.
  test("an escaped closing bracket in an emphasised link keeps both", () => {
    expect(parseInline("*[a \\] b](https://x.example/a*b) c*")).toEqual([
      {
        kind: "em",
        children: [{ kind: "link", href: "https://x.example/a*b", children: [text("a ] b")] }, text(" c")],
      },
    ]);
  });

  test("an escaped bracket in link text keeps the link", () => {
    expect(parseInline("[a \\[b](https://example.com)")).toEqual([
      { kind: "link", href: "https://example.com/", children: [text("a [b")] },
    ]);
    expect(parseInline("[a \\](b](https://example.com)")).toEqual([
      { kind: "link", href: "https://example.com/", children: [text("a ](b")] },
    ]);
  });

  test("inline code, links and autolinks", () => {
    expect(parseReadme("Run `npm ci` then see [the docs](https://x.example/d) or <https://y.example>.")).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "Run " },
          { kind: "code", text: "npm ci" },
          { kind: "text", text: " then see " },
          { kind: "link", href: "https://x.example/d", children: [{ kind: "text", text: "the docs" }] },
          { kind: "text", text: " or " },
          { kind: "link", href: "https://y.example/", children: [{ kind: "text", text: "https://y.example/" }] },
          { kind: "text", text: "." },
        ],
      },
    ]);
  });

  test("underscores inside a word stay text", () => {
    expect(parseReadme("my_var_name and _this_")).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "my_var_name and " },
          { kind: "em", children: [{ kind: "text", text: "this" }] },
        ],
      },
    ]);
  });

  test("a heading keeps any of the six levels, and seven marks are a paragraph", () => {
    expect(parseReadme("##### Deep\n\n###### Six\n\n####### Seven")).toEqual([
      { kind: "heading", level: 5, children: [{ kind: "text", text: "Deep" }] },
      { kind: "heading", level: 6, children: [{ kind: "text", text: "Six" }] },
      { kind: "paragraph", children: [{ kind: "text", text: "####### Seven" }] },
    ]);
  });

  test("an unclosed code fence runs to the end", () => {
    expect(parseReadme("```js\nlet a\n\nlet b")).toEqual([{ kind: "code", text: "let a\n\nlet b" }]);
  });

  test("NUL and other controls are removed before parsing", () => {
    expect(parseReadme("a\u0000b\u0007c")).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: "abc" }] }]);
  });
});

// CommonMark 0.31.2, "Backslash escapes" (https://spec.commonmark.org/0.31.2/#backslash-escapes): any ASCII
// punctuation after a backslash is that character as text, and opens or closes nothing. The rich editor (remark-
// stringify 11) writes these for a literal `*`, `_` or `[`, so the page must not show the backslash.
describe("backslash escapes", () => {
  test("an escaped mark is the mark as text", () => {
    expect(parseInline("a \\* b \\_ c \\[d]")).toEqual([text("a * b _ c [d]")]);
  });

  test("an escaped mark opens no emphasis and closes none", () => {
    expect(parseInline("\\*not em\\*")).toEqual([text("*not em*")]);
    expect(parseInline("*a \\* b*")).toEqual([{ kind: "em", children: [text("a * b")] }]);
  });

  test("an escaped backslash is one backslash, and the mark after it still counts", () => {
    expect(parseInline("\\\\*em*")).toEqual([text("\\"), { kind: "em", children: [text("em")] }]);
  });

  test("a backslash before anything that is not ASCII punctuation stays", () => {
    expect(parseInline("C:\\dir \\é")).toEqual([text("C:\\dir \\é")]);
  });

  test("inside a code span a backslash is text", () => {
    expect(parseInline("`a\\*b`")).toEqual([{ kind: "code", text: "a\\*b" }]);
  });

  // Codex review of #1827: an escaped backtick opens no code span, so it cannot hide the mark that closes emphasis.
  test("an escaped backtick opens no code span", () => {
    expect(parseInline("*a \\` b* c \\`")).toEqual([{ kind: "em", children: [text("a ` b")] }, text(" c `")]);
    expect(parseInline("\\``code`")).toEqual([text("`"), { kind: "code", text: "code" }]);
  });

  // Codex review of #1827: an escaped star before a closing star is text, not part of the closer's run.
  test("an escaped star before a closing star still lets it close", () => {
    expect(parseInline("*a \\**")).toEqual([{ kind: "em", children: [text("a *")] }]);
  });

  // Codex review of #1827: the editor writes italics with "_", so bold and italic together are "**_word_**".
  test("bold around italic reads as both", () => {
    expect(parseInline("**_word_**")).toEqual([
      { kind: "strong", children: [{ kind: "em", children: [text("word")] }] },
    ]);
    expect(parseInline("_**word**_")).toEqual([
      { kind: "em", children: [{ kind: "strong", children: [text("word")] }] },
    ]);
    expect(parseInline("**a _b_**")).toEqual([
      { kind: "strong", children: [text("a "), { kind: "em", children: [text("b")] }] },
    ]);
  });

  // CommonMark 0.31.2 "Entity and numeric character references": remark writes the letters beside an italic inside a
  // word as numeric references, so "_" there still opens and closes.
  test("numeric character references are their characters", () => {
    expect(parseInline("u&#x6E;_&#x62;elie&#x76;_&#x61;ble")).toEqual([
      text("un"),
      { kind: "em", children: [text("believ")] },
      text("able"),
    ]);
    expect(parseInline("&#42;not em&#42; &#0; &#xD800; &#x110000; &#12345678;")).toEqual([
      text("*not em* \uFFFD \uFFFD \uFFFD &#12345678;"),
    ]);
    expect(parseInline("`&#x41;`")).toEqual([{ kind: "code", text: "&#x41;" }]);
  });

  test("an escaped hash at the start of a line is a paragraph, not a heading", () => {
    expect(parseReadme("\\# not a heading")).toEqual([{ kind: "paragraph", children: [text("# not a heading")] }]);
  });
});

describe("what the in-place editor writes (P1.21s)", () => {
  test("a line ended with a backslash or two spaces breaks the line, and a plain line end is a space", () => {
    expect(parseReadme("one\\\ntwo  \nthree\nfour")).toEqual([
      {
        kind: "paragraph",
        children: [text("one"), { kind: "break" }, text("two"), { kind: "break" }, text("three four")],
      },
    ]);
  });

  test("a quote keeps its paragraphs and its line breaks", () => {
    expect(parseReadme("> first\n> line\\\n> next\n>\n> second")).toEqual([
      {
        kind: "quote",
        paragraphs: [[text("first line"), { kind: "break" }, text("next")], [text("second")]],
      },
    ]);
  });

  test("the empty line marker an earlier editor wrote shows nothing", () => {
    expect(parseReadme("one\n\n<br />\n\ntwo\n\n<br>\n\n> <br />")).toEqual([
      { kind: "paragraph", children: [text("one")] },
      { kind: "paragraph", children: [text("two")] },
    ]);
  });

  // GitHub Flavored Markdown 0.29 (cmark-gfm test/spec.txt), "Strikethrough (extension)" and "Task list items
  // (extension)": Alex, 2026-11-21, "every single thing that you can do in markdown".
  test("words between two tildes each side are struck through, and a single tilde is text", () => {
    expect(parseInline("~~Hi~~ Hello, **~~world~~**")).toEqual([
      { kind: "del", children: [text("Hi")] },
      text(" Hello, "),
      { kind: "strong", children: [{ kind: "del", children: [text("world")] }] },
    ]);
    expect(parseInline("~one~ and ~~ two")).toEqual([text("~one~ and ~~ two")]);
  });

  // GFM 0.29 example 493: a run of three or more tildes neither opens nor closes strikethrough.
  test("a run of three or more tildes is text, not strikethrough", () => {
    expect(parseInline("This will ~~~not~~~ strike.")).toEqual([text("This will ~~~not~~~ strike.")]);
    expect(parseInline("~~a~~~ and ~~~b~~")).toEqual([{ kind: "del", children: [text("a~~~ and ~~~b")] }]);
  });

  test("a struck run does not reach past the paragraph it opens in", () => {
    expect(parseReadme("This ~~has a\n\nnew paragraph~~.")).toEqual([
      { kind: "paragraph", children: [text("This ~~has a")] },
      { kind: "paragraph", children: [text("new paragraph~~.")] },
    ]);
  });

  test("a list item opening with a task marker is a task, ticked by an x of either case", () => {
    const src = ["- [ ] foo", "- [x] bar", "  - [X] baz", "- [y] not a task", "- [ ]", "1. [ ] numbered"].join("\n");
    expect(parseReadme(src)).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          { text: [text("foo")], lists: [], task: "open" },
          {
            text: [text("bar")],
            lists: [{ kind: "list", ordered: false, items: [{ text: [text("baz")], lists: [], task: "done" }] }],
            task: "done",
          },
          item("[y] not a task"),
          item("[ ]"),
        ],
      },
      { kind: "list", ordered: true, items: [{ text: [text("numbered")], lists: [], task: "open" }] },
    ]);
  });

  // GFM 0.29, "Tables (extension)".
  test("a header row, a delimiter row and data rows are a table, aligned by the delimiter's colons", () => {
    const src = ["| abc | defghi |", ":-: | -----------:", "bar | baz", "| f\\|oo | `a\\|b` |", "", "after"].join("\n");
    expect(parseReadme(src)).toEqual([
      {
        kind: "table",
        align: ["center", "right"],
        head: [[text("abc")], [text("defghi")]],
        rows: [
          [[text("bar")], [text("baz")]],
          [[text("f|oo")], [{ kind: "code", text: "a|b" }]],
        ],
      },
      { kind: "paragraph", children: [text("after")] },
    ]);
  });

  // Codex on 08db77c: an escaped backslash does not escape the pipe after it, so that pipe still splits the row, and
  // a row ending in one still drops its closing pipe (micromark-extension-gfm-table 2.1.1, syntax.js).
  test("a pipe after an escaped backslash splits the row, and a backslash escapes only the character after it", () => {
    const src = ["| a | b |", "| --- | --- |", "|x\\\\|y\\\\|", "|p\\\\\\|q|r|"].join("\n");
    expect(parseReadme(src)).toEqual([
      {
        kind: "table",
        align: [null, null],
        head: [[text("a")], [text("b")]],
        rows: [
          [[text("x\\")], [text("y\\")]],
          [[text("p\\|q")], [text("r")]],
        ],
      },
    ]);
  });

  test("a row with fewer cells is filled, one with more is cut, and a line that starts a block ends the table", () => {
    const src = ["| a | b |", "| --- | --- |", "| one |", "| x | y | z |", "> quoted"].join("\n");
    expect(parseReadme(src)).toEqual([
      {
        kind: "table",
        align: [null, null],
        head: [[text("a")], [text("b")]],
        rows: [
          [[text("one")], []],
          [[text("x")], [text("y")]],
        ],
      },
      { kind: "quote", paragraphs: [[text("quoted")]] },
    ]);
  });

  test("a header whose cells do not match the delimiter row is no table", () => {
    expect(parseReadme("| abc | def |\n| --- |\n| bar |")).toEqual([
      { kind: "paragraph", children: [text("| abc | def | | --- | | bar |")] },
    ]);
  });
});

// Alex 2026-11-21: "bare addresses become https". GFM 0.29 "Autolinks (extension)", as micromark-extension-gfm-autolink-
// literal 2.1.0 reads it (dev/lib/syntax.js), which is what the editor reads: the page links the same words.
describe("bare addresses", () => {
  const link = (href: string, words: string) => ({ kind: "link", href, children: [text(words)] });

  test("an address and a www name are links, and www opens over https", () => {
    expect(parseInline("see https://example.com/a and www.example.org.")).toEqual([
      text("see "),
      link("https://example.com/a", "https://example.com/a"),
      text(" and "),
      link("https://www.example.org/", "www.example.org"),
      text("."),
    ]);
  });

  test("closing punctuation after an address is not part of it", () => {
    expect(parseInline("(see https://example.com/a_(b)), then http://x.example/?q=1!")).toEqual([
      text("(see "),
      link("https://example.com/a_(b)", "https://example.com/a_(b)"),
      text("), then "),
      link("http://x.example/?q=1", "http://x.example/?q=1"),
      text("!"),
    ]);
  });

  test("an address ends at a space or a <, and a trailing &name; is not part of it", () => {
    expect(parseInline("www.a.example/x&amp; and https://b.example<c")).toEqual([
      link("https://www.a.example/x", "www.a.example/x"),
      text("&amp; and "),
      link("https://b.example/", "https://b.example"),
      text("<c"),
    ]);
  });

  test("an address inside emphasis is a link inside it", () => {
    expect(parseInline("*www.example.org*")).toEqual([
      { kind: "em", children: [link("https://www.example.org/", "www.example.org")] },
    ]);
  });

  test("what is not an address stays text", () => {
    for (const words of [
      "awww.example.org",
      "xhttps://example.org",
      "www.",
      "https://",
      "www.a_b.example_c",
      "https://exa_mple.com",
      "ftp://example.org",
      "`https://example.org`",
    ]) {
      expect(
        parseInline(words).some((node) => node.kind === "link"),
        words,
      ).toBe(false);
    }
  });

  test("an address inside a link's words is not a second link", () => {
    expect(parseInline("[www.a.example](https://b.example/)")).toEqual([link("https://b.example/", "www.a.example")]);
  });
});
