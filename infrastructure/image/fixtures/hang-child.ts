// A stand-in child for pool.test.ts that never answers, to test the timeout's SIGKILL.
import { onJob, say } from "./stand-in.ts";

say({ ready: true });
onJob(() => undefined);
