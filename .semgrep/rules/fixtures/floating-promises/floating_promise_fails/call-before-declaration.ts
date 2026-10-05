// Must fail: the call comes before the (hoisted) async declaration.
export function start(): void {
  doAsync();
}

async function doAsync(): Promise<void> {
  await Promise.resolve();
}
