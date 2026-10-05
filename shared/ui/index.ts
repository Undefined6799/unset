// Shared UI (MIT). P1.10: the island props serialiser (server) and reader (client).
export { type JsonValue, renderPropsTag, SerializeError, serializeProps } from "./islands/props.ts";
export { PropsMissing, readProps } from "./src/islands/readProps.ts";
