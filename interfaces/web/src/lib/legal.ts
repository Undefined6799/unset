// What a legal page draws (P1.20d): its load fills the parsed document into these, and the page renders them.

/** What the page draws: text, bold, a checked link, nested as the document has them. */
export type Run =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Run[] }
  | { kind: "link"; href: string; children: Run[] };
export type Section =
  | { kind: "h"; level: 1 | 2 | 3; runs: Run[] }
  | { kind: "p"; runs: Run[] }
  | { kind: "ul"; items: Run[][] }
  | { kind: "table"; headers: Run[][]; rows: Run[][][] };
