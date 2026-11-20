// A stand-in child for pool.test.ts that answers as an exploited decoder might: a version nobody asked for, larger
// than any limit, with a made-up hash. The parent must refuse the whole answer.
process.send?.({ ready: true });
process.on("message", (job: { id: number }) => {
  const bytes = new Uint8Array(3_000_000);
  process.send?.({
    id: job.id,
    result: {
      kind: "ok",
      width: 10,
      height: 10,
      versions: [{ name: "evil", format: "jpeg", width: 10, height: 10, bytes, sha256: "0".repeat(64) }],
    },
  });
});
