type Node = Readonly<{
  nodeName: string;
  tagName?: string;
  attrs?: readonly Readonly<{ name: string; value: string }>[];
  childNodes?: readonly Node[];
  value?: string;
}>;

/** Parsed elements let response tests ignore attribute order and styling classes. */
export function elements(
  node: Node | undefined,
  tag: string,
  attributes: Readonly<Record<string, string>> = {},
): Node[] {
  if (node === undefined) return [];
  const matches =
    node.tagName === tag &&
    Object.entries(attributes).every(([name, value]) =>
      node.attrs?.some((attribute) => attribute.name === name && attribute.value === value),
    );
  const children = node.childNodes?.flatMap((child) => elements(child, tag, attributes)) ?? [];
  return [...(matches ? [node] : []), ...children];
}

export function textContent(node: Node | undefined): string {
  if (node === undefined) return "";
  return node.value ?? node.childNodes?.map(textContent).join("") ?? "";
}
