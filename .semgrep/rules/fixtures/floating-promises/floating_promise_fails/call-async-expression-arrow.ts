// Must fail: a call to an async arrow function with an expression body.
const ping = async (): Promise<number> => Promise.resolve(1);

ping();
