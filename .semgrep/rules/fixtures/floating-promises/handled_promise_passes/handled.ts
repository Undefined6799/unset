// Must pass: every promise is awaited, returned, voided or given a rejection handler.
declare const p: Promise<number>;
declare const f: (n: number) => void;
declare const g: (e: unknown) => void;
declare const h: (e: unknown) => void;

async function doAsync(): Promise<void> {
  await Promise.resolve();
}

export function returned(): Promise<void> {
  return doAsync();
}

await doAsync();
void doAsync();
p.then(f, g);
p.catch(h);
p.then(f).catch(h);
export const kept = doAsync();
export const answer = Promise.resolve()
  .then(() => doAsync())
  .catch(() => {
    throw new Error("failed");
  });
