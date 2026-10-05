// Must fail: forEach ignores the promises its async callback returns.
declare const xs: number[];
declare const save: (x: number) => Promise<void>;

xs.forEach(async (x) => {
  await save(x);
});
