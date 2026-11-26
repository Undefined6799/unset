// Must fail: a bare call stays a finding beside statements that handle the same function's promise.
async function one(n: number): Promise<number> {
  return n;
}

export async function mixed(left: boolean): Promise<number> {
  const [a] = await Promise.all([one(1)]);
  one(2);
  return left ? one(a) : one(3);
}
