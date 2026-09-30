import { createServer } from "node:http";
import {
  MerchantClient,
  WebhookVerificationError,
  verifyWebhook,
} from "@pepepow/pepewpay-merchant";
import { createTelegramCheckout } from "../src/index.mjs";
import {
  applyTelegramPaymentWebhook,
  disableTemporaryWebhook,
  registerTemporaryWebhook,
} from "../src/e2e.mjs";
import { telegramApiCall, normalizeTelegramApiEnvironment } from "../src/transport.mjs";

const MAX_BODY_BYTES = 64 * 1024;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function privateMessage(update) {
  if (
    !update ||
    typeof update !== "object" ||
    update.message?.chat?.type !== "private"
  ) {
    throw new Error("A fresh private Telegram message is required.");
  }
  const chatId = String(update.message.chat.id);
  const messageId = String(update.message.message_id);
  if (!/^-?(?:0|[1-9][0-9]{0,23})$/.test(chatId)) {
    throw new Error("Telegram chat id is invalid.");
  }
  if (!/^(?:0|[1-9][0-9]{0,15})$/.test(messageId)) {
    throw new Error("Telegram message id is invalid.");
  }
  return { chatId, messageId };
}

async function waitForFreshPrivateMessage(token, apiEnvironment) {
  const backlog = await telegramApiCall({
    token,
    method: "getUpdates",
    body: {
      offset: -1,
      limit: 1,
      timeout: 0,
      allowed_updates: ["message"],
    },
    apiEnvironment,
  });
  const last = Array.isArray(backlog) ? backlog.at(-1) : null;
  const offset = Number.isInteger(last?.update_id) ? last.update_id + 1 : undefined;

  console.log(`Waiting for one fresh private message in Telegram ${apiEnvironment} environment...`);
  const body = {
    limit: 1,
    timeout: 50,
    allowed_updates: ["message"],
  };
  if (offset !== undefined) body.offset = offset;

  const updates = await telegramApiCall({
    token,
    method: "getUpdates",
    body,
    apiEnvironment,
  });
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new Error("No fresh private Telegram message arrived.");
  }
  return privateMessage(updates[0]);
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("webhook_body_too_large");
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

const config = {
  telegramToken: required("TELEGRAM_BOT_TOKEN"),
  telegramApiEnvironment: normalizeTelegramApiEnvironment(process.env.TELEGRAM_API_ENV ?? "test"),
  apiKey: required("PEPEW_MERCHANT_API_KEY"),
  receiveAddress: required("PEPEW_RECEIVE_ADDRESS"),
  publicWebhookUrl: required("PEPEW_PUBLIC_WEBHOOK_URL"),
  apiOrigin: process.env.PEPEW_PAYMENT_API_ORIGIN ?? "https://pay.pepepow.net",
  checkoutBaseUrl: process.env.PEPEW_CHECKOUT_BASE_URL ?? "https://pay.pepepow.net/",
  amount: process.env.PEPEW_E2E_AMOUNT ?? "0.1",
  confirmations: positiveInt("PEPEW_CONFIRMATIONS", 1),
  expiresIn: positiveInt("PEPEW_EXPIRES_IN", 900),
  timeoutSeconds: positiveInt("PEPEW_E2E_TIMEOUT_SECONDS", 1200),
  host: process.env.PEPEW_E2E_HOST ?? "127.0.0.1",
  port: positiveInt("PEPEW_E2E_PORT", 8788),
};

const webhookPath = new URL(config.publicWebhookUrl).pathname;
if (!webhookPath || webhookPath === "/") {
  throw new Error("PEPEW_PUBLIC_WEBHOOK_URL must include a callback path such as /webhooks/pepew");
}

const state = {
  signingSecret: null,
  endpointId: null,
  paymentId: null,
  merchantReference: null,
  currentVersion: null,
  chatId: null,
  telegramMessageId: null,
  checkoutUrl: null,
  terminalResolve: null,
};

let terminalResolved = false;
const terminalPromise = new Promise((resolve) => {
  state.terminalResolve = (value) => {
    if (terminalResolved) return;
    terminalResolved = true;
    resolve(value);
  };
});

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "POST" || requestUrl.pathname !== webhookPath) {
      res.writeHead(404, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    if (!state.signingSecret) {
      res.writeHead(503, { "Cache-Control": "no-store" });
      res.end();
      return;
    }

    const rawBody = await readRawBody(req);
    if (!state.paymentId) {
      // Endpoint exists before the invoice does. Authenticate any delivery before
      // ignoring it so even the pre-invoice window preserves the webhook boundary.
      verifyWebhook({
        headers: normalizedHeaders(req.headers),
        rawBody,
        signingSecret: state.signingSecret,
      });
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }

    const result = await applyTelegramPaymentWebhook({
      headers: normalizedHeaders(req.headers),
      rawBody,
      signingSecret: state.signingSecret,
      expectedPaymentId: state.paymentId,
      expectedMerchantReference: state.merchantReference,
      currentVersion: state.currentVersion,
      telegramToken: config.telegramToken,
      chatId: state.chatId,
      messageId: state.telegramMessageId,
      amount: config.amount,
      checkoutUrl: state.checkoutUrl,
      telegramApiEnvironment: config.telegramApiEnvironment,
    });

    if (!result.ignored && result.decision?.apply) {
      state.currentVersion = result.decision.paymentVersion;
      console.log(`Verified payment webhook applied: ${result.decision.paymentStatus}`);
      if (result.decision.terminal) {
        state.terminalResolve(result.decision);
      }
    }
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
  } catch (error) {
    if (error instanceof WebhookVerificationError || error instanceof TypeError) {
      res.writeHead(400, { "Cache-Control": "no-store" });
    } else {
      // Telegram edit transport failures are retryable by the Payment Platform.
      res.writeHead(503, { "Cache-Control": "no-store" });
    }
    res.end();
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(config.port, config.host, resolve);
});
console.log(`Local webhook receiver listening on ${config.host}:${config.port}`);

try {
  const registration = await registerTemporaryWebhook({
    apiOrigin: config.apiOrigin,
    apiKey: config.apiKey,
    url: config.publicWebhookUrl,
  });
  state.endpointId = registration.endpointId;
  state.signingSecret = registration.signingSecret;
  console.log("Temporary Payment Platform webhook endpoint registered.");

  const bot = await telegramApiCall({
    token: config.telegramToken,
    method: "getMe",
    body: {},
    apiEnvironment: config.telegramApiEnvironment,
  });
  if (!Number.isInteger(bot?.id)) throw new Error("Telegram bot identity is invalid.");
  console.log(`Telegram ${config.telegramApiEnvironment} bot authenticated.`);

  const incoming = await waitForFreshPrivateMessage(config.telegramToken, config.telegramApiEnvironment);
  const merchantClient = new MerchantClient({
    apiKey: config.apiKey,
    apiOrigin: config.apiOrigin,
  });
  const checkout = await createTelegramCheckout({
    merchantClient,
    receiveAddress: config.receiveAddress,
    amount: config.amount,
    botId: String(bot.id),
    chatId: incoming.chatId,
    messageId: incoming.messageId,
    confirmations: config.confirmations,
    expiresIn: config.expiresIn,
    checkoutBaseUrl: config.checkoutBaseUrl,
  });

  const sent = await telegramApiCall({
    token: config.telegramToken,
    method: "sendMessage",
    body: checkout.sendMessage,
    apiEnvironment: config.telegramApiEnvironment,
  });
  if (!Number.isInteger(sent?.message_id)) {
    throw new Error("Telegram sendMessage response is invalid.");
  }

  state.paymentId = checkout.paymentId;
  state.merchantReference = checkout.merchantReference;
  state.currentVersion = checkout.paymentVersion;
  state.chatId = incoming.chatId;
  state.telegramMessageId = String(sent.message_id);
  state.checkoutUrl = checkout.checkoutUrl;

  console.log("Real PEPEW test invoice sent to Telegram.");
  console.log("Pay it from a wallet address different from PEPEW_RECEIVE_ADDRESS.");
  console.log("Waiting for verified Payment Platform webhook updates...");

  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Telegram payment E2E timed out before a terminal webhook state.")),
      config.timeoutSeconds * 1000,
    );
    timer.unref?.();
  });
  const interrupted = new Promise((_, reject) => {
    const stop = () => reject(new Error("Telegram payment E2E interrupted by operator."));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  const terminal = await Promise.race([terminalPromise, timeout, interrupted]);
  console.log(`Telegram payment E2E terminal state: ${terminal.state}`);
} finally {
  if (state.endpointId) {
    try {
      await disableTemporaryWebhook({
        apiOrigin: config.apiOrigin,
        apiKey: config.apiKey,
        endpointId: state.endpointId,
      });
      console.log("Temporary Payment Platform webhook endpoint disabled.");
    } catch {
      console.error("WARNING: temporary webhook endpoint cleanup failed; disable it manually.");
    }
  }
  await new Promise((resolve) => server.close(resolve));
}
