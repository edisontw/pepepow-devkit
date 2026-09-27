import {
  TelegramTransportSmokeError,
  runTelegramTransportSmoke,
} from "../src/transport.mjs";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error(
    "TELEGRAM_BOT_TOKEN is required in the environment; the token is never accepted as a command-line argument.",
  );
  process.exitCode = 1;
} else {
  const statusText = {
    telegram_test_bot_authenticated: "Telegram test bot authenticated.",
    waiting_for_fresh_private_message:
      "Waiting for one fresh private message in the Telegram Test Environment...",
    telegram_smoke_message_sent:
      "Smoke reply sent with the Pay with PEPEW HTTPS inline button.",
  };

  try {
    await runTelegramTransportSmoke({
      token,
      onStatus(status) {
        console.log(statusText[status] ?? "Telegram transport smoke progressed.");
      },
    });
  } catch (error) {
    if (error instanceof TelegramTransportSmokeError) {
      console.error(`Telegram transport smoke failed: ${error.message}`);
    } else {
      console.error("Telegram transport smoke failed with an unexpected local error.");
    }
    process.exitCode = 1;
  }
}
