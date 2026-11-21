// Must pass: each call's promise is handled by the statement it sits in, so the statement is not a floating call.
// The shapes are the ones the rule wrongly flagged on PR #1935 (CI semgrep job, 2026-11-21).
class Unavailable extends Error {}

async function one(n: number): Promise<number> {
  return n;
}

async function two(n: number): Promise<number> {
  return n * 2;
}

export async function awaitedInPromiseAll(): Promise<number> {
  const [a, b] = await Promise.all([one(1), two(2)]);
  return a + b;
}

export async function awaitedInPromiseAllNotDestructured(): Promise<number> {
  const both = await Promise.all([one(1), two(2)]);
  return both.length;
}

export async function awaitedWithCatch(): Promise<number | "failed"> {
  const outcome = await one(1).catch((error: unknown) => {
    if (error instanceof Unavailable) return "failed" as const;
    throw error;
  });
  return outcome;
}

export async function returnedFromEitherBranch(left: boolean): Promise<number> {
  return left ? one(1) : two(2);
}
