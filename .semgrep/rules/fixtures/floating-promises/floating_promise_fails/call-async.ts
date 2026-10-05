// Must fail: a call to a function declared async in the same file, as a bare statement.
async function doAsync(): Promise<void> {
  await Promise.resolve();
}

doAsync();
