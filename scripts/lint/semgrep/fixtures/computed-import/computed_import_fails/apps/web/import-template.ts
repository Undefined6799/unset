// Must fail: a template literal with a substitution is not a literal.
export const load = (x: string) => import(`./${x}.js`);
