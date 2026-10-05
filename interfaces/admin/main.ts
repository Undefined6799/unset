// Starts the admin server: read the config once, compose, listen (P1.04). The server drains on SIGTERM or SIGINT.
import { bootOrExit } from "@unset/shared-config";
import { compose } from "./compose.ts";
import { config } from "./config.ts";

const { server } = await compose(bootOrExit(config));
await server.listen();
