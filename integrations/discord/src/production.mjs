import { createServer } from "node:http";
import {
  MerchantClient,
  WebhookVerificationError,
  verifyWebhook,
} from "@pepepow/pepewpay-merchant";
import { RuntimeStateStore, pendingPaymentCount } from "../../shared/runtime-state.mjs";
import {
  createDiscordChannelMessage,
  editDiscordChannelMessage,
} from "./bot-api.mjs";
import {
  buildDiscordPayMessage,
  decideDiscordPaymentEvent,
  discordMerchantReference,
  createDiscordCheckout,
} from "./index.mjs";
import {
  DiscordInteractionError,
  extractDiscordPaymentCommand,
  parseVerifiedDiscordInteraction,
} from "./transport.mjs";

const MAX_BODY_BYTES = 64 * 1024;

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

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    Connection: "close",
  });
  res.end(payload);
}

function empty(res, status) {
  res.writeHead(status, { "Cache-Control": "no-store", Connection: "close" });
  res.end();
}

function safeCode(error) {
  return String(error?.code ?? error?.name ?? "error").slice(0, 96);
}

function findByMerchantReference(state, reference) {
  return Object.entries(state.payments).find(([, record]) =>
    record && record.merchant_reference === reference,
  );
}

export async function runDiscordProductionRuntime(env = process.env) {
  const config = {
    publicKey: required(env.DISCORD_PUBLIC_KEY, "discord_public_key"),
    botToken: required(env.DISCORD_BOT_TOKEN, "discord_bot_token"),
    apiKey: required(env.PEPEW_MERCHANT_API_KEY, "merchant_api_key"),
    signingSecret: required(env.PEPEW_WEBHOOK_SIGNING_SECRET, "webhook_signing_secret"),
    apiOrigin: env.PEPEW_PAYMENT_API_ORIGIN ?? "https://pay.pepepow.net",
    checkoutBaseUrl: env.PEPEW_CHECKOUT_BASE_URL ?? "https://pay.pepepow.net/",
    confirmations: positiveInt(env.PEPEW_CONFIRMATIONS, 1, "confirmations"),
    expiresIn: positiveInt(env.PEPEW_EXPIRES_IN, 900, "expires_in"),
    host: env.PEPEW_BOT_HOST ?? "127.0.0.1",
    port: positiveInt(env.PEPEW_BOT_PORT, 8791, "bot_port"),
    interactionsPath: env.DISCORD_INTERACTIONS_PATH ?? "/pepew-discord/interactions",
    webhookPath: env.PEPEW_WEBHOOK_PATH ?? "/pepew-discord/webhooks/pepew",
    statePath: env.PEPEW_STATE_FILE ?? "./data/runtime-state.json",
  };
  if (!config.interactionsPath.startsWith("/") || config.interactionsPath === "/") {
    throw new Error("discord_interactions_path_invalid");
  }
  if (!config.webhookPath.startsWith("/") || config.webhookPath === "/") {
    throw new Error("webhook_path_invalid");
  }
  if (config.interactionsPath === config.webhookPath) throw new Error("callback_paths_conflict");

  const store = new RuntimeStateStore({ path: config.statePath, platform: "discord" });
  const state = await store.load();
  store.prune(state);
  await store.save(state);
  const merchantClient = new MerchantClient({ apiKey: config.apiKey, apiOrigin: config.apiOrigin });
  let paymentCreationInProgress = false;

  async function createPayment(command) {
    const reference = discordMerchantReference({
      applicationId: command.applicationId,
      channelId: command.channelId,
      interactionId: command.interactionId,
    });
    if (findByMerchantReference(state, reference)) {
      paymentCreationInProgress = false;
      return;
    }

    try {
      const checkout = await createDiscordCheckout({
        merchantClient,
        receiveAddress: command.address,
        amount: command.amount,
        applicationId: command.applicationId,
        channelId: command.channelId,
        interactionId: command.interactionId,
        confirmations: config.confirmations,
        expiresIn: config.expiresIn,
        checkoutBaseUrl: config.checkoutBaseUrl,
      });
      const sent = await createDiscordChannelMessage({
        token: config.botToken,
        channelId: command.channelId,
        message: checkout.createMessage,
      });
      const now = Math.floor(Date.now() / 1000);
      state.payments[checkout.paymentId] = {
        merchant_reference: checkout.merchantReference,
        current_version: checkout.paymentVersion,
        status: checkout.paymentStatus,
        channel_id: command.channelId,
        discord_message_id: sent.id,
        amount: command.amount,
        checkout_url: checkout.checkoutUrl,
        created_at: now,
        updated_at: now,
        terminal_at: null,
      };
      await store.save(state);
      console.log("discord_payment_created");
    } catch (error) {
      console.error(`discord_payment_create_failed code=${safeCode(error)}`);
      try {
        await createDiscordChannelMessage({
          token: config.botToken,
          channelId: command.channelId,
          message: {
            content: "PEPEW payment request could not be created. Please try again.",
            allowed_mentions: { parse: [] },
          },
        });
      } catch (notifyError) {
        console.error(`discord_payment_failure_notice_failed code=${safeCode(notifyError)}`);
      }
    } finally {
      paymentCreationInProgress = false;
    }
  }

  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && requestUrl.pathname === "/healthz") {
      json(res, 200, {
        ok: true,
        service: "pepew-discord-bot",
        pending_payments: pendingPaymentCount(state),
      });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === config.interactionsPath) {
      try {
        const rawBody = await readRawBody(req);
        const interaction = parseVerifiedDiscordInteraction({
          publicKey: config.publicKey,
          signature: req.headers["x-signature-ed25519"],
          timestamp: req.headers["x-signature-timestamp"],
          rawBody,
        });
        if (interaction.type === 1) {
          json(res, 200, { type: 1 });
          return;
        }
        const command = extractDiscordPaymentCommand(interaction);
        if (paymentCreationInProgress || pendingPaymentCount(state) > 0) {
          json(res, 200, {
            type: 4,
            data: {
              content: "A PEPEW payment is already in progress. Please try again after it is confirmed or expires.",
              flags: 64,
              allowed_mentions: { parse: [] },
            },
          });
          return;
        }
        paymentCreationInProgress = true;
        json(res, 200, {
          type: 4,
          data: {
            content: `Creating PEPEW payment request for ${command.amount} PEPEW to ${command.address}.`,
            flags: 64,
            allowed_mentions: { parse: [] },
          },
        });
        void createPayment(command);
      } catch (error) {
        if (error instanceof DiscordInteractionError) {
          empty(res, 401);
        } else {
          console.error(`discord_interaction_failed code=${safeCode(error)}`);
          empty(res, 500);
        }
      }
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === config.webhookPath) {
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
        const decision = decideDiscordPaymentEvent({
          currentVersion: record.current_version,
          event,
        });
        if (!decision.apply) {
          empty(res, 204);
          return;
        }
        const message = buildDiscordPayMessage({
          amount: record.amount,
          checkoutUrl: record.checkout_url,
        });
        message.content = [message.content, decision.content].join("\n");
        await editDiscordChannelMessage({
          token: config.botToken,
          channelId: record.channel_id,
          messageId: record.discord_message_id,
          message,
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
          console.error(`discord_webhook_failed code=${safeCode(error)}`);
          empty(res, 503);
        }
      }
      return;
    }

    empty(res, 404);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  console.log(`pepew_discord_bot_started host=${config.host} port=${config.port}`);

  await new Promise((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await new Promise((resolve) => server.close(resolve));
  console.log("pepew_discord_bot_stopped");
}
