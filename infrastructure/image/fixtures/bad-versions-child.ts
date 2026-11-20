// A stand-in child for pool.test.ts whose answer has the right id but a null result on the first job and versions
// that are not a list on every later one.
let jobs = 0;
process.send?.({ ready: true });
process.on("message", (job: { id: number }) => {
  jobs += 1;
  const result = jobs === 1 ? null : { kind: "ok", width: 10, height: 10, versions: "not a list" };
  process.send?.({ id: job.id, result });
});
