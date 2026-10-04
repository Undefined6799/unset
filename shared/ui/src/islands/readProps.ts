// Client side of the island props hand-off (P1.10): reads what serializeProps wrote. If the props are missing or
// unreadable the island does not hydrate and the server-rendered HTML stays.
import type { JsonValue } from "../../islands/props.ts";

export class PropsMissing extends Error {
  constructor(id: string) {
    super(`island props missing or unreadable: ${id}`);
    this.name = "PropsMissing";
  }
}

export function readProps(id: string): JsonValue {
  const element = document.getElementById(id);
  // Only the JSON script element counts, so a same-id element elsewhere on the page is never read as props.
  if (!(element instanceof HTMLScriptElement) || element.type !== "application/json") throw new PropsMissing(id);
  try {
    return JSON.parse(element.textContent ?? "") as JsonValue;
  } catch {
    throw new PropsMissing(id);
  }
}
