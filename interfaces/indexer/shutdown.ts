// The indexer's stop (book P3.05s PR 3): after SIGTERM has aborted the stream and the passes, wait for them and the
// pool to finish, and for the health server to close, but never past `graceMs`. Docker kills the process 10 s after
// SIGTERM (`docker stop`, default --time), so the grace stays under that and the process reports its own outcome:
// `finished` when everything ended in time, `deadline` when the grace ran out (an in-flight transaction is then rolled
// back by Postgres when the socket closes), `failed` when a step rejected. main.ts logs which and exits 0 only on
// `finished`.

export type StopOutcome = "finished" | "deadline" | "failed";

export async function stopWithin(steps: readonly Promise<void>[], graceMs: number): Promise<StopOutcome> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<StopOutcome>((resolve) => {
    timer = setTimeout(() => resolve("deadline"), graceMs);
  });
  const finished = Promise.all(steps).then(
    (): StopOutcome => "finished",
    (): StopOutcome => "failed",
  );
  try {
    return await Promise.race([finished, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
