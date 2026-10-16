// Starts the web server (unset.sh): read the config once, compose, check the database budget, listen (P1.04, P2.04c).
import { bootOrExit, exitOnConfigError } from "@unset/shared-config";
import { compose } from "./compose.ts";
import { config } from "./config.ts";

// Building and the budget check can still refuse the config (a PLC_URL net-guard does not allow, pools the database
// role cannot hold) as a ConfigError: exit 78, like a bad key.
const { server, boot } = await compose(bootOrExit(config)).catch(exitOnConfigError);
await boot().catch(exitOnConfigError);
await server.listen();
