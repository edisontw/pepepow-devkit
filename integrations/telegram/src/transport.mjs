const TELEGRAM_TEST_API_ORIGIN = "https://api.telegram.org";
const BOT_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;
const CHAT_ID_RE = /^-?(?:0|[1-9][0-9]{0,23})$/;
const ALLOWED_METHODS = new Set(["getMe", "getUpdates", "sendMessage"]);

export class TelegramTransportSmokeError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "TelegramTransportSmokeError";
    this.code = code;
  }
}

function normalizeBotToken(value) {
  const token = String(value ?? "").trim();
  if (!BOT_TOKEN_RE.test(token)) {
    throw new TelegramTransportSmokeError(
      "telegram_bot_token_invalid",
      "TELEGRAM_BOT_TOKEN is missing or has an invalid format.",
    );
  }
  return token;
}

function normalizeChatId(value) {
  const chatId = String(value ?? "").trim();
  if (!CHAT_ID_RE.test(chatId)) {
    throw new TelegramTransportSmokeError(
      "telegram_chat_id_invalid",
      "Telegram update did not contain a valid chat id.",
    );
  }
  return chatId;
}

function safeTelegramDescription(value) {
  return String(value ?? "Telegram API request failed.")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 240);
}

export function buildTelegramTransportSmokeMessage({
  chatId,
  checkoutUrl = "https://pay.pepepow.net/",
}) {
  const normalizedChatId = normalizeChatId(chatId);
  const url = new URL(checkoutUrl);
  if (url.protocol !== "https:") {
    throw new TelegramTransportSmokeError(
      "telegram_smoke_checkout_url_invalid",
      "Transport smoke checkout URL must use HTTPS.",
    );
  }

  return {
    chat_id: normalizedChatId,
    text: [
      "PEPEW merchant payment transport smoke",
      "TEST ONLY — no Payment Platform invoice was created.",
    ].join("\n"),
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Pay with PEPEW",
            url: url.toString(),
          },
        ],
      ],
    },
  };
}

export async function telegramTestApiCall({
  token,
  method,
  body = {},
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = 65000,
}) {
  const normalizedToken = normalizeBotToken(token);
  if (!ALLOWED_METHODS.has(method)) {
    throw new TelegramTransportSmokeError(
      "telegram_smoke_method_not_allowed",
      "Telegram transport smoke attempted an unsupported Bot API method.",
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetch_impl_invalid");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetchImpl(
      `${TELEGRAM_TEST_API_ORIGIN}/bot${normalizedToken}/test/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
  } catch {
    throw new TelegramTransportSmokeError(
      `telegram_${method}_transport_failed`,
      `Telegram Test Bot API ${method} transport failed.`,
    );
  } finally {
    clearTimeout(timer);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new TelegramTransportSmokeError(
      `telegram_${method}_response_invalid`,
      `Telegram Test Bot API ${method} returned invalid JSON.`,
    );
  }

  if (!response.ok || payload?.ok !== true) {
    throw new TelegramTransportSmokeError(
      `telegram_${method}_failed`,
      safeTelegramDescription(payload?.description),
    );
  }

  return payload.result;
}

function nextOffsetFromBacklog(result) {
  if (!Array.isArray(result) || result.length === 0) return undefined;
  const updateId = result.at(-1)?.update_id;
  return Number.isInteger(updateId) ? updateId + 1 : undefined;
}

function privateChatIdFromUpdate(update) {
  if (!update || typeof update !== "object" || !update.message) {
    throw new TelegramTransportSmokeError(
      "telegram_smoke_message_update_required",
      "Transport smoke requires a Telegram message update.",
    );
  }
  if (update.message.chat?.type !== "private") {
    throw new TelegramTransportSmokeError(
      "telegram_smoke_private_chat_required",
      "Transport smoke only replies to a private Telegram chat.",
    );
  }
  return normalizeChatId(update.message.chat.id);
}

export async function runTelegramTransportSmoke({
  token,
  apiCall = telegramTestApiCall,
  onStatus = () => {},
  checkoutUrl = "https://pay.pepepow.net/",
}) {
  if (typeof apiCall !== "function") throw new TypeError("api_call_invalid");
  if (typeof onStatus !== "function") throw new TypeError("on_status_invalid");

  await apiCall({ token, method: "getMe", body: {} });
  onStatus("telegram_test_bot_authenticated");

  const backlog = await apiCall({
    token,
    method: "getUpdates",
    body: {
      offset: -1,
      limit: 1,
      timeout: 0,
      allowed_updates: ["message"],
    },
  });
  const offset = nextOffsetFromBacklog(backlog);
  onStatus("waiting_for_fresh_private_message");

  const updateBody = {
    limit: 1,
    timeout: 50,
    allowed_updates: ["message"],
  };
  if (offset !== undefined) updateBody.offset = offset;

  const updates = await apiCall({
    token,
    method: "getUpdates",
    body: updateBody,
  });
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new TelegramTransportSmokeError(
      "telegram_smoke_update_timeout",
      "No fresh Telegram Test Environment message arrived during the smoke window.",
    );
  }

  const chatId = privateChatIdFromUpdate(updates[0]);
  const sendMessage = buildTelegramTransportSmokeMessage({ chatId, checkoutUrl });
  await apiCall({
    token,
    method: "sendMessage",
    body: sendMessage,
  });
  onStatus("telegram_smoke_message_sent");

  return { received: true, sent: true };
}
