// Must fail: a call to an async arrow function declared in the same file.
const doAsync = async (): Promise<void> => {
  await Promise.resolve();
};

doAsync();
