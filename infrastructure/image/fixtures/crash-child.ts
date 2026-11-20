// A stand-in child for pool.test.ts that dies on its first job, as a native fault in libvips would.
process.on("message", () => process.kill(process.pid, "SIGSEGV"));
