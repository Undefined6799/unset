// Must fail: process.mainModule.require in any form, literal or not.
declare const process: { mainModule: { require: (id: string) => unknown } };
export const pg = process.mainModule.require("pg");
