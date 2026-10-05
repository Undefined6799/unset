// Must pass: string-literal specifiers dependency-cruiser can follow.
import { createRequire } from "node:module";

declare const require: (id: string) => unknown;
export const a = () => import("./a.js");
export const b = () => require("./b.js");
export const c = (u: string) => createRequire(u)("./c.js");
