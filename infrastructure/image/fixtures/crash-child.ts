// A stand-in child for pool.test.ts that dies on its first job, as a native fault in libvips would.
import { onJob, say } from "./stand-in.ts";

say({ ready: true });
onJob(() => process.kill(process.pid, "SIGSEGV"));
