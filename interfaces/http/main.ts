// Starts the web server (unset.sh): read the config once, compose, check the database budget, listen (P1.04, P2.04c).
import { bootOrExit } from "@unset/shared-config";
import { compose } from "./compose.ts";
import { config } from "./config.ts";

const { server, boot } = await compose(bootOrExit(config));
await boot();
await server.listen();
