import { DISCORD_PAYMENT_COMMAND } from "./transport.mjs";

export const DISCORD_API_ORIGIN = "https://discord.com/api/v10";
const DISCORD_ID_RE = /^[1-9][0-9]{0,19}$/;

export class DiscordBotApiError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = "DiscordBotApiError";
    this.code = code;
    this.status = status;
  }
}

function normalizeToken(value) {
  const token = String(value ?? "").trim();
  if (
    token.length < 20 ||
    token.length > 256 ||
    /\s/.test(token)
  ) {
    throw new DiscordBotApiError("discord_bot_token_invalid");
  }
  return token;
}

function snowflake(value, code) {
  const text = String(value ?? "").trim();
  if (!DISCORD_ID_RE.test(text)) {
    throw new DiscordBotApiError(code);
  }
  return text;
}

function safeErrorCode(payload) {
  if (
    payload &&
    typeof payload === "object" &&
    (typeof payload.code === "number" || typeof payload.code === "string")
  ) {
    return `discord_api_${String(payload.code).slice(0, 48)}`;
  }
  return "discord_api_error";
}

async function discordRequest({
  token,
  method,
  path,
  body,
  fetchImpl = fetch,
  timeoutMs = 10_000,
}) {
  const botToken = normalizeToken(token);
  if (!["GET", "POST", "PATCH"].includes(method)) {
    throw new DiscordBotApiError("discord_method_invalid");
  }
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new DiscordBotApiError("discord_path_invalid");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(`${DISCORD_API_ORIGIN}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bot ${botToken}`,
          ...(typeof body === "undefined"
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: typeof body === "undefined" ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const code =
        error instanceof Error && error.name === "AbortError"
          ? "discord_api_timeout"
          : "discord_api_network_error";
      throw new DiscordBotApiError(code);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      if (!response.ok) {
        throw new DiscordBotApiError("discord_api_invalid_json", response.status);
      }
    }

    if (!response.ok) {
      throw new DiscordBotApiError(
        safeErrorCode(payload),
        response.status,
      );
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export async function createDiscordChannelMessage({
  token,
  channelId,
  message,
  fetchImpl,
}) {
  const channel = snowflake(channelId, "discord_channel_id_invalid");
  const payload = await discordRequest({
    token,
    method: "POST",
    path: `/channels/${channel}/messages`,
    body: message,
    fetchImpl,
  });
  if (!payload || typeof payload !== "object") {
    throw new DiscordBotApiError("discord_message_response_invalid");
  }
  return {
    ...payload,
    id: snowflake(payload.id, "discord_message_id_invalid"),
  };
}

export async function editDiscordChannelMessage({
  token,
  channelId,
  messageId,
  message,
  fetchImpl,
}) {
  const channel = snowflake(channelId, "discord_channel_id_invalid");
  const target = snowflake(messageId, "discord_message_id_invalid");
  const payload = await discordRequest({
    token,
    method: "PATCH",
    path: `/channels/${channel}/messages/${target}`,
    body: message,
    fetchImpl,
  });
  if (!payload || typeof payload !== "object") {
    throw new DiscordBotApiError("discord_message_response_invalid");
  }
  return {
    ...payload,
    id: snowflake(payload.id, "discord_message_id_invalid"),
  };
}

export async function ensureDiscordGuildPaymentCommand({
  token,
  applicationId,
  guildId,
  fetchImpl,
}) {
  const application = snowflake(
    applicationId,
    "discord_application_id_invalid",
  );
  const guild = snowflake(guildId, "discord_guild_id_invalid");
  const base = `/applications/${application}/guilds/${guild}/commands`;

  const commands = await discordRequest({
    token,
    method: "GET",
    path: base,
    fetchImpl,
  });
  if (!Array.isArray(commands)) {
    throw new DiscordBotApiError("discord_command_list_invalid");
  }

  const existing = commands.filter(
    (command) =>
      command &&
      typeof command === "object" &&
      command.name === DISCORD_PAYMENT_COMMAND.name,
  );
  if (existing.length > 1) {
    throw new DiscordBotApiError("discord_command_not_unique");
  }

  const method = existing.length === 1 ? "PATCH" : "POST";
  const path =
    existing.length === 1
      ? `${base}/${snowflake(existing[0].id, "discord_command_id_invalid")}`
      : base;

  const result = await discordRequest({
    token,
    method,
    path,
    body: DISCORD_PAYMENT_COMMAND,
    fetchImpl,
  });
  if (!result || typeof result !== "object") {
    throw new DiscordBotApiError("discord_command_response_invalid");
  }
  return {
    ...result,
    id: snowflake(result.id, "discord_command_id_invalid"),
  };
}
