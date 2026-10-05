// Must fail: a domain loading a module by name (for example pg).
export const load = (name: string) => import(name);
