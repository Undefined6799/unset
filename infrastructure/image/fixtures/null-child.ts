// A stand-in child for pool.test.ts that answers a job with null, as a taken-over decoder might.
import { onJob, say } from "./stand-in.ts";

say({ ready: true });
onJob(() => say(null));
