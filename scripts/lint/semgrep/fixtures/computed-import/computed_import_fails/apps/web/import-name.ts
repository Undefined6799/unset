// Must fail: import() of an identifier.
export const load = (name: string) => import(name);
