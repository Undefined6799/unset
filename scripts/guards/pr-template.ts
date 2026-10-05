// PR template headings (P0.09c; rule DL-3): the PR-lint check P0.09's template test names. Every `## ` heading of
// the template appears in the body; a field may say n/a, but it may not be deleted.

const headings = (markdown: string): string[] =>
  [...markdown.replaceAll("\r", "").matchAll(/^## (.+?)\s*$/gm)].map((match) => match[1] as string);

/** The template headings missing from the body, in template order. */
export function checkPrTemplate(body: string, template: string): string[] {
  const present = new Set(headings(body));
  return headings(template).filter((heading) => !present.has(heading));
}
