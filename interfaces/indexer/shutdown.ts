// The indexer's stop (book P3.05s PR 3): after SIGTERM has aborted the stream and the passes, wait for them and the
// pool to finish, and for the health server to close, but never past `graceMs`. Docker kills the process 10 s after
// SIGTERM (`docker stop`, default --time), so the grace stays under that and the process reports its own outcome: 0
// when everything finished in time, 1 when the deadline cut it short (an in-flight transaction is then rolled back by
// Postgres when the socket closes).

export async function stopWithin(steps: readonly Promise<void>[], graceMs: number): Promise<0 | 1> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<1>((resolve) => {
    timer = setTimeout(() => resolve(1), graceMs);
  });
  const finished = Promise.all(steps).then(
    (): 0 | 1 => 0,
    (): 0 | 1 => 1,
  );
  try {
    return await Promise.race([finished, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
