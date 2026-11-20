// A stand-in child for pool.test.ts that never answers, to test the timeout's SIGKILL.
process.send?.({ ready: true });
process.on("message", () => undefined);
