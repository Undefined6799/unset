// Must fail: module.require in any form, literal or not.
declare const module: { require: (id: string) => unknown };
export const pg = module.require("pg");
