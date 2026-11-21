// chat-admin's entry point (ADR 0093 decision 5): read the config, compose, serve on its one address (LISTEN_ADDRESS),
// so only the network web and the door share with it reaches the listener. Any boot failure prints one line
// naming the setting, never a value, and exits 1.
import { createServer } from "node:http"; // guard-allow: egress inbound listener only, sends nothing out
import { compose } from "./compose.ts";
import { BootError, readConfig } from "./config.ts";

async function boot(): Promise<void> {
  const config = readConfig(process.env);
  const { handler, compactDaily } = await compose(config);
  setInterval(compactDaily, 86_400_000).unref();
  createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, handler).listen(config.port, config.listenAddress);
}

boot().catch((error: unknown) => {
  process.stderr.write(`chat-admin: ${error instanceof BootError ? error.message : "boot failed"}\n`);
  process.exit(1);
});
