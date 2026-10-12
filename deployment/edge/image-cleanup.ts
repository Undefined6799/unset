// The edge image tests' cleanup (P1.11r). Each test file removes the tags it built, by tag and never with -f (P1.27z).
// A removal killed for running too long throws, so a plain map over the tags stopped at the first one and never tried
// the rest; this tries every tag and reports every failure with its tag, as the images tests do
// (deployment/images/package-manager.image.test.ts, P1.27x). It imports nothing, so the trusted tests that use it stay
// free of product test code.

/** Runs `remove` on every tag, even after one throws, then throws one AggregateError naming each tag that failed. */
export function removeEveryTag(tags: readonly string[], remove: (tag: string) => void): void {
  const failures: Error[] = [];
  for (const tag of tags) {
    try {
      remove(tag);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(new Error(`docker rmi ${tag} failed: ${reason}`, { cause: error }));
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, failures.map((failure) => failure.message).join("; "));
}
