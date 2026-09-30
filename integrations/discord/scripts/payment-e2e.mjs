import { createServer } from "node:http";
import {
  MerchantClient,
  WebhookVerificationError,
  verifyWebhook,
} from "@pepepow/pepewpay-merchant";
import { createDiscordCheckout } from "../src/index.mjs";
import {
  createDiscordChannelMessage,
} from "../src/bot-api.mjs";
import {
  DiscordInteractionError,
  extractDiscordPaymentCommand,
  parseVerifiedDiscordInteraction,
} from "../src/transport.mjs";
import {
  applyDiscordPaymentWebhook,
  disableTemporaryDiscordWebhook,
  registerTemporaryDiscordWebhook,
} from "../src/e2e.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const AMOUNT_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(name + " is required");
  return value;
}

function positiveInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(name + " must be a positive integer");
  }
  return value;
}

function amountToAtoms(value) {
  const text = String(value ?? "").trim();
  if (!AMOUNT_RE.test(text)) throw new Error("PEPEW amount is invalid.");
  const parts = text.split(".");
  const whole = parts[0];
  const fraction = parts[1] ?? "";
  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("request_body_too_large");
    }
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
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "Connection": "close",
  });
  res.end(payload);
}

function empty(res, status) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Connection": "close",
  });
  res.end();
}

async function closeServer(server) {
  await new Promise((resolve) => {
    let settled = false;
    let forceTimer;

    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      resolve();
    };

    server.close(done);
    server.closeIdleConnections?.();

    forceTimer = setTimeout(() => {
      server.closeAllConnections?.();
      done();
    }, 1000);
  });
}

const config = {
  publicKey: required("DISCORD_PUBLIC_KEY"),
  botToken: required("DISCORD_BOT_TOKEN"),
  apiKey: required("PEPEW_MERCHANT_API_KEY"),
  receiveAddress: required("PEPEW_RECEIVE_ADDRESS"),
  publicWebhookUrl: required("PEPEW_PUBLIC_WEBHOOK_URL"),
  apiOrigin: process.env.PEPEW_PAYMENT_API_ORIGIN ?? "https://pay.pepepow.net",
  checkoutBaseUrl:
    process.env.PEPEW_CHECKOUT_BASE_URL ?? "https://pay.pepepow.net/",
  amount: process.env.PEPEW_E2E_AMOUNT ?? "0.1",
  confirmations: positiveInt("PEPEW_CONFIRMATIONS", 1),
  expiresIn: positiveInt("PEPEW_EXPIRES_IN", 900),
  timeoutSeconds: positiveInt("PEPEW_E2E_TIMEOUT_SECONDS", 1200),
  host: process.env.DISCORD_E2E_HOST ?? "127.0.0.1",
  port: positiveInt("DISCORD_E2E_PORT", 8789),
  interactionsPath:
    process.env.DISCORD_INTERACTIONS_PATH ??
    "/pepew-discord-e2e/interactions",
};

const expectedAmountAtoms = amountToAtoms(config.amount);
if (expectedAmountAtoms <= 0n) {
  throw new Error("PEPEW_E2E_AMOUNT must be positive.");
}

const webhookUrl = new URL(config.publicWebhookUrl);
const webhookPath = webhookUrl.pathname;
if (!webhookPath || webhookPath === "/") {
  throw new Error(
    "PEPEW_PUBLIC_WEBHOOK_URL must include a callback path such as /pepew-discord-e2e/webhooks/pepew",
  );
}
if (webhookPath === config.interactionsPath) {
  throw new Error("Discord interaction and Payment webhook paths must differ.");
}

const merchantClient = new MerchantClient({
  apiKey: config.apiKey,
  apiOrigin: config.apiOrigin,
});

const state = {
  signingSecret: null,
  endpointId: null,
  commandAccepted: false,
  paymentId: null,
  merchantReference: null,
  currentVersion: null,
  channelId: null,
  discordMessageId: null,
  checkoutUrl: null,
};

let outcomeSettled = false;
let resolveOutcome;
let rejectOutcome;
const outcomePromise = new Promise((resolve, reject) => {
  resolveOutcome = resolve;
  rejectOutcome = reject;
});

function succeedOnce(value) {
  if (outcomeSettled) return;
  outcomeSettled = true;
  resolveOutcome(value);
}

function failOnce(error) {
  if (outcomeSettled) return;
  outcomeSettled = true;
  rejectOutcome(error);
}

async function createRealPaymentFromCommand(command) {
  try {
    const checkout = await createDiscordCheckout({
      merchantClient,
      receiveAddress: config.receiveAddress,
      amount: config.amount,
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

    state.paymentId = checkout.paymentId;
    state.merchantReference = checkout.merchantReference;
    state.currentVersion = checkout.paymentVersion;
    state.channelId = command.channelId;
    state.discordMessageId = sent.id;
    state.checkoutUrl = checkout.checkoutUrl;

    console.log("Real PEPEW test invoice sent to Discord.");
    console.log(
      "Pay it from a wallet address different from PEPEW_RECEIVE_ADDRESS.",
    );
    console.log("Waiting for verified Payment Platform webhook updates...");
  } catch (error) {
    failOnce(error);
  }
}

async function handleInteraction(req, res) {
  const rawBody = await readRawBody(req);
  const interaction = parseVerifiedDiscordInteraction({
    publicKey: config.publicKey,
    signature: req.headers["x-signature-ed25519"],
    timestamp: req.headers["x-signature-timestamp"],
    rawBody,
  });

  if (interaction.type === 1) {
    json(res, 200, { type: 1 });
    console.log("Verified Discord PING acknowledged.");
    return;
  }

  const command = extractDiscordPaymentCommand(interaction);
  console.log("Verified Discord /pepew-pay interaction received.");

  let amountMatches = false;
  try {
    amountMatches = amountToAtoms(command.amount) === expectedAmountAtoms;
  } catch {
    amountMatches = false;
  }
  if (!amountMatches) {
    json(res, 200, {
      type: 4,
      data: {
        content:
          "This bounded PEPEW E2E harness only accepts " +
          config.amount +
          " PEPEW.",
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    });
    return;
  }

  if (state.commandAccepted) {
    json(res, 200, {
      type: 4,
      data: {
        content: "A PEPEW Discord E2E payment is already in progress.",
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    });
    return;
  }

  state.commandAccepted = true;
  json(res, 200, {
    type: 4,
    data: {
      content:
        "PEPEW real-payment E2E accepted. Creating one " +
        config.amount +
        " PEPEW test invoice.",
      flags: 64,
      allowed_mentions: { parse: [] },
    },
  });

  void createRealPaymentFromCommand(command);
}

async function handleWebhook(req, res) {
  if (!state.signingSecret) {
    empty(res, 503);
    return;
  }

  const rawBody = await readRawBody(req);
  if (!state.paymentId) {
    verifyWebhook({
      headers: normalizedHeaders(req.headers),
      rawBody,
      signingSecret: state.signingSecret,
    });
    empty(res, 204);
    return;
  }

  const result = await applyDiscordPaymentWebhook({
    headers: normalizedHeaders(req.headers),
    rawBody,
    signingSecret: state.signingSecret,
    expectedPaymentId: state.paymentId,
    expectedMerchantReference: state.merchantReference,
    currentVersion: state.currentVersion,
    discordToken: config.botToken,
    channelId: state.channelId,
    messageId: state.discordMessageId,
    amount: config.amount,
    checkoutUrl: state.checkoutUrl,
  });

  if (!result.ignored && result.decision?.apply) {
    state.currentVersion = result.decision.paymentVersion;
    console.log(
      "Verified payment webhook applied: " + result.decision.paymentStatus,
    );
    if (result.decision.terminal) {
      succeedOnce(result.decision);
    }
  }
  empty(res, 204);
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");

  if (req.method !== "POST") {
    empty(res, 404);
    return;
  }

  if (requestUrl.pathname === config.interactionsPath) {
    try {
      await handleInteraction(req, res);
    } catch (error) {
      if (error instanceof DiscordInteractionError) {
        console.error("Discord interaction rejected: " + error.code);
        empty(res, 401);
      } else {
        console.error(
          "Discord interaction handler failed before acknowledgement: " +
            (error?.name ?? "Error"),
        );
        empty(res, 500);
      }
    }
    return;
  }

  if (requestUrl.pathname === webhookPath) {
    try {
      await handleWebhook(req, res);
    } catch (error) {
      if (error instanceof WebhookVerificationError || error instanceof TypeError) {
        empty(res, 400);
      } else {
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

console.log(
  "Discord payment E2E listening on " +
    config.host +
    ":" +
    config.port +
    config.interactionsPath,
);
console.log("Payment webhook path: " + webhookPath);

try {
  const registration = await registerTemporaryDiscordWebhook({
    apiOrigin: config.apiOrigin,
    apiKey: config.apiKey,
    url: config.publicWebhookUrl,
  });
  state.endpointId = registration.endpointId;
  state.signingSecret = registration.signingSecret;
  console.log("Temporary Payment Platform webhook endpoint registered.");
  console.log(
    "Run /pepew-pay amount:" +
      config.amount +
      " once in the selected Discord test channel.",
  );

  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            "Discord payment E2E timed out before a terminal webhook state.",
          ),
        ),
      config.timeoutSeconds * 1000,
    );
    timer.unref?.();
  });
  const interrupted = new Promise((_, reject) => {
    const stop = () =>
      reject(new Error("Discord payment E2E interrupted by operator."));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  const terminal = await Promise.race([
    outcomePromise,
    timeout,
    interrupted,
  ]);
  console.log("Discord payment E2E terminal state: " + terminal.state);
} finally {
  if (state.endpointId) {
    try {
      await disableTemporaryDiscordWebhook({
        apiOrigin: config.apiOrigin,
        apiKey: config.apiKey,
        endpointId: state.endpointId,
      });
      console.log("Temporary Payment Platform webhook endpoint disabled.");
    } catch {
      console.error(
        "WARNING: temporary webhook endpoint cleanup failed; disable it manually.",
      );
    }
  }
  await closeServer(server);
}
