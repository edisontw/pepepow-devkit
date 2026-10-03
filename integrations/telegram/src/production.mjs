import { createServer } from "node:http";
import {
  MerchantClient,
  WebhookVerificationError,
  verifyWebhook,
} from "@pepepow/pepewpay-merchant";
import { RuntimeStateStore, pendingPaymentCount } from "../../shared/runtime-state.mjs";
import {
  buildTelegramStatusEdit,
} from "./e2e.mjs";
import {
  createTelegramCheckout,
  decideTelegramPaymentEvent,
} from "./index.mjs";
import {
  normalizeTelegramApiEnvironment,
  telegramApiCall,
} from "./transport.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const AMOUNT_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/;

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}_required`);
  return text;
}

function positiveInt(value, fallback, label) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label}_invalid`);
  return parsed;
}

function normalizeAmount(value) {
  const text = String(value ?? "").trim();
  if (!AMOUNT_RE.test(text)) throw new TypeError("amount_invalid");
  const [whole, fraction = ""] = text.split(".");
  const atoms = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
  if (atoms <= 0n) throw new TypeError("amount_invalid");
  return text;
}

const TELEGRAM_CHAT_TYPES = new Set(["private", "group", "supergroup"]);
const BOT_USERNAME_RE = /^[A-Za-z0-9_]{1,64}$/;

function normalizeBotUsername(value) {
  const username = String(value ?? "").trim().replace(/^@/, "");
  if (!BOT_USERNAME_RE.test(username)) throw new Error("telegram_bot_username_invalid");
  return username;
}

export function parseTelegramPayCommand(
  text,
  { chatType = "private", botUsername } = {},
) {
  const input = String(text ?? "").trim();
  const match = /^\/(pay|pepew-pay)(?:@([A-Za-z0-9_]+))?(?:\s+(.+))?$/i.exec(input);
  if (!match) return { matched: false };

  const normalizedChatType = String(chatType ?? "").trim().toLowerCase();
  if (!TELEGRAM_CHAT_TYPES.has(normalizedChatType)) return { matched: false };

  const targetUsername = match[2] ?? null;
  const normalizedBotUsername =
    botUsername == null || botUsername === "" ? null : normalizeBotUsername(botUsername);

  if (
    targetUsername &&
    (
      !normalizedBotUsername ||
      targetUsername.toLowerCase() !== normalizedBotUsername.toLowerCase()
    )
  ) {
    return { matched: false };
  }

  if (!match[3]) return { matched: true, error: "usage" };

  const parts = match[3].trim().split(/\s+/);
  if (parts.length !== 2) return { matched: true, error: "usage" };

  const [address, amount] = parts;
  try {
    return {
      matched: true,
      address,
      amount: normalizeAmount(amount),
    };
  } catch {
    return { matched: true, error: "amount" };
  }
}

export function telegramMessageFromUpdate(update) {
  const message = update?.message;
  const chatType = String(message?.chat?.type ?? "").trim().toLowerCase();
  if (!message || !TELEGRAM_CHAT_TYPES.has(chatType)) return null;
  const chatId = String(message.chat.id ?? "");
  const messageId = String(message.message_id ?? "");
  if (!/^-?(?:0|[1-9][0-9]{0,23})$/.test(chatId)) return null;
  if (!/^(?:0|[1-9][0-9]{0,15})$/.test(messageId)) return null;
  return { chatId, messageId, chatType, text: String(message.text ?? "") };
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function normalizedHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
}

function empty(res, status) {
  res.writeHead(status, { "Cache-Control": "no-store", Connection: "close" });
  res.end();
}

function health(res, state) {
  const payload = Buffer.from(JSON.stringify({
    ok: true,
    service: "pepew-telegram-bot",
    pending_payments: pendingPaymentCount(state),
  }));
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function safeCode(error) {
  return String(error?.code ?? error?.name ?? "error").slice(0, 96);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runTelegramProductionRuntime(env = process.env) {
  const config = {
    token: required(env.TELEGRAM_BOT_TOKEN, "telegram_bot_token"),
    apiEnvironment: normalizeTelegramApiEnvironment(env.TELEGRAM_API_ENV ?? "production"),
    apiKey: required(env.PEPEW_MERCHANT_API_KEY, "merchant_api_key"),
    signingSecret: required(env.PEPEW_WEBHOOK_SIGNING_SECRET, "webhook_signing_secret"),
    apiOrigin: env.PEPEW_PAYMENT_API_ORIGIN ?? "https://pay.pepepow.net",
    checkoutBaseUrl: env.PEPEW_CHECKOUT_BASE_URL ?? "https://pay.pepepow.net/",
    confirmations: positiveInt(env.PEPEW_CONFIRMATIONS, 1, "confirmations"),
    expiresIn: positiveInt(env.PEPEW_EXPIRES_IN, 900, "expires_in"),
    host: env.PEPEW_BOT_HOST ?? "127.0.0.1",
    port: positiveInt(env.PEPEW_BOT_PORT, 8790, "bot_port"),
    webhookPath: env.PEPEW_WEBHOOK_PATH ?? "/pepew-telegram/webhooks/pepew",
    statePath: env.PEPEW_STATE_FILE ?? "./data/runtime-state.json",
  };
  if (!config.webhookPath.startsWith("/") || config.webhookPath === "/") {
    throw new Error("webhook_path_invalid");
  }

  const store = new RuntimeStateStore({ path: config.statePath, platform: "telegram" });
  const state = await store.load();
  store.prune(state);
  await store.save(state);

  const merchantClient = new MerchantClient({ apiKey: config.apiKey, apiOrigin: config.apiOrigin });
  const bot = await telegramApiCall({
    token: config.token,
    method: "getMe",
    body: {},
    apiEnvironment: config.apiEnvironment,
  });
  if (!Number.isInteger(bot?.id)) throw new Error("telegram_bot_identity_invalid");
  const botId = String(bot.id);
  const botUsername = normalizeBotUsername(bot.username);

  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && requestUrl.pathname === "/healthz") {
      health(res, state);
      return;
    }
    if (req.method !== "POST" || requestUrl.pathname !== config.webhookPath) {
      empty(res, 404);
      return;
    }

    try {
      const rawBody = await readRawBody(req);
      const event = verifyWebhook({
        headers: normalizedHeaders(req.headers),
        rawBody,
        signingSecret: config.signingSecret,
      });
      const record = state.payments[event.payment_id];
      if (!record) {
        empty(res, 204);
        return;
      }
      if (
        event.data.merchant_reference != null &&
        event.data.merchant_reference !== record.merchant_reference
      ) {
        empty(res, 204);
        return;
      }

      const decision = decideTelegramPaymentEvent({
        currentVersion: record.current_version,
        event,
      });
      if (!decision.apply) {
        empty(res, 204);
        return;
      }
      const edit = buildTelegramStatusEdit({
        chatId: record.chat_id,
        messageId: record.telegram_message_id,
        address: record.address,
        amount: record.amount,
        checkoutUrl: record.checkout_url,
        decision,
      });
      await telegramApiCall({
        token: config.token,
        method: "editMessageText",
        body: edit,
        apiEnvironment: config.apiEnvironment,
      });
      record.current_version = decision.paymentVersion;
      record.status = decision.paymentStatus;
      record.updated_at = Math.floor(Date.now() / 1000);
      record.terminal_at = decision.terminal ? record.updated_at : null;
      await store.save(state);
      empty(res, 204);
    } catch (error) {
      if (error instanceof WebhookVerificationError || error instanceof TypeError) {
        empty(res, 400);
      } else {
        console.error(`telegram_webhook_failed code=${safeCode(error)}`);
        empty(res, 503);
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  console.log(`pepew_telegram_bot_started host=${config.host} port=${config.port}`);

  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    if (state.update_offset === null) {
      const backlog = await telegramApiCall({
        token: config.token,
        method: "getUpdates",
        body: { offset: -1, limit: 1, timeout: 0, allowed_updates: ["message"] },
        apiEnvironment: config.apiEnvironment,
      });
      const last = Array.isArray(backlog) ? backlog.at(-1) : null;
      if (Number.isInteger(last?.update_id)) {
        state.update_offset = last.update_id + 1;
        await store.save(state);
      }
    }

    let failures = 0;
    while (!stopping) {
      try {
        const body = { limit: 20, timeout: 50, allowed_updates: ["message"] };
        if (state.update_offset !== null) body.offset = state.update_offset;
        const updates = await telegramApiCall({
          token: config.token,
          method: "getUpdates",
          body,
          apiEnvironment: config.apiEnvironment,
        });
        failures = 0;
        for (const update of Array.isArray(updates) ? updates : []) {
          const incoming = telegramMessageFromUpdate(update);
          if (incoming) {
            const command = parseTelegramPayCommand(incoming.text, {
              chatType: incoming.chatType,
              botUsername,
            });
            if (command.matched && command.error) {
              await telegramApiCall({
                token: config.token,
                method: "sendMessage",
                body: {
                  chat_id: incoming.chatId,
                  text: "Usage: /pay <address> <amount>\nExample: /pay PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb 10",
                  link_preview_options: { is_disabled: true },
                },
                apiEnvironment: config.apiEnvironment,
              });
            } else if (command.matched && pendingPaymentCount(state) > 0) {
              await telegramApiCall({
                token: config.token,
                method: "sendMessage",
                body: {
                  chat_id: incoming.chatId,
                  text: "A PEPEW payment is already in progress. Please try again after it is confirmed or expires.",
                  link_preview_options: { is_disabled: true },
                },
                apiEnvironment: config.apiEnvironment,
              });
            } else if (command.matched) {
              const checkout = await createTelegramCheckout({
                merchantClient,
                receiveAddress: command.address,
                amount: command.amount,
                botId,
                chatId: incoming.chatId,
                messageId: incoming.messageId,
                confirmations: config.confirmations,
                expiresIn: config.expiresIn,
                checkoutBaseUrl: config.checkoutBaseUrl,
              });
              const sent = await telegramApiCall({
                token: config.token,
                method: "sendMessage",
                body: checkout.sendMessage,
                apiEnvironment: config.apiEnvironment,
              });
              if (!Number.isInteger(sent?.message_id)) throw new Error("telegram_send_response_invalid");
              const now = Math.floor(Date.now() / 1000);
              state.payments[checkout.paymentId] = {
                merchant_reference: checkout.merchantReference,
                current_version: checkout.paymentVersion,
                status: checkout.paymentStatus,
                chat_id: incoming.chatId,
                telegram_message_id: String(sent.message_id),
                address: command.address,
                amount: command.amount,
                checkout_url: checkout.checkoutUrl,
                created_at: now,
                updated_at: now,
                terminal_at: null,
              };
              await store.save(state);
              console.log("telegram_payment_created");
            }
          }
          if (Number.isInteger(update?.update_id)) {
            state.update_offset = update.update_id + 1;
            await store.save(state);
          }
        }
      } catch (error) {
        failures += 1;
        console.error(`telegram_poll_failed code=${safeCode(error)} consecutive=${failures}`);
        await sleep(Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5)));
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log("pepew_telegram_bot_stopped");
  }
}
