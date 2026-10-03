import { runDiscordProductionRuntime } from "../src/production.mjs";

runDiscordProductionRuntime().catch((error) => {
  console.error(`pepew_discord_bot_fatal code=${String(error?.code ?? error?.name ?? "error").slice(0, 96)}`);
  process.exitCode = 1;
});
