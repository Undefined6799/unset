// A stand-in child for pool.test.ts that answers a job with null, as a taken-over decoder might.
process.send?.({ ready: true });
process.on("message", () => process.send?.(null));
