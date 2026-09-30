import { ensureDiscordGuildPaymentCommand } from "../src/bot-api.mjs";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

await ensureDiscordGuildPaymentCommand({
  token: required("DISCORD_BOT_TOKEN"),
  applicationId: required("DISCORD_APPLICATION_ID"),
  guildId: required("DISCORD_GUILD_ID"),
});

console.log("Discord guild-scoped /pepew-pay test command is ready.");
