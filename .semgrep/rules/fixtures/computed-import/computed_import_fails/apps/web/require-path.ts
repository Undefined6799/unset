// Must fail: require() of an identifier.
declare const require: (id: string) => unknown;
export const load = (path: string) => require(path);
