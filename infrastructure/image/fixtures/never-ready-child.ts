// A stand-in child for pool.test.ts that starts and then hangs without ever saying it is ready, as a hang while
// sharp or libvips loads would.
setInterval(() => undefined, 60_000);
