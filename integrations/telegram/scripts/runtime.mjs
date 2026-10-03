import { runTelegramProductionRuntime } from "../src/production.mjs";

runTelegramProductionRuntime().catch((error) => {
  console.error(`pepew_telegram_bot_fatal code=${String(error?.code ?? error?.name ?? "error").slice(0, 96)}`);
  process.exitCode = 1;
});
