// A stand-in child for pool.test.ts whose versions name themselves with an object that cannot become a string.
process.send?.({ ready: true });
process.on("message", (job: { id: number }) => {
  const version = { name: { toString: 1 }, format: "jpeg", width: 10, height: 10, bytes: new Uint8Array(1) };
  process.send?.({ id: job.id, result: { kind: "ok", width: 10, height: 10, versions: [version] } });
});
