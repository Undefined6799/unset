// Must fail: createRequire(...) called with a computed specifier.
import { createRequire } from "node:module";

export const load = (u: string, p: string) => createRequire(u)(p);
