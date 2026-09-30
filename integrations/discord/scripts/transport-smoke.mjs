import { createServer } from "node:http";
import { buildDiscordPayMessage } from "../src/index.mjs";
import { createDiscordChannelMessage } from "../src/bot-api.mjs";
import {
  DiscordInteractionError,
  extractDiscordPaymentCommand,
  parseVerifiedDiscordInteraction,
} from "../src/transport.mjs";

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

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new DiscordInteractionError("discord_body_too_large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

const config = {
  publicKey: required("DISCORD_PUBLIC_KEY"),
  botToken: required("DISCORD_BOT_TOKEN"),
  host: process.env.DISCORD_SMOKE_HOST ?? "127.0.0.1",
  port: positiveInt("DISCORD_SMOKE_PORT", 8789),
  path:
    process.env.DISCORD_INTERACTIONS_PATH ??
    "/pepew-discord-e2e/interactions",
  timeoutSeconds: positiveInt("DISCORD_SMOKE_TIMEOUT_SECONDS", 1200),
};

let resolved = false;
let finish;
const finished = new Promise((resolve, reject) => {
  finish = { resolve, reject };
});
const seenInteractions = new Set();

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "POST" || requestUrl.pathname !== config.path) {
      res.writeHead(404, { "Cache-Control": "no-store" });
      res.end();
      return;
    }

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
    const paymentStyle = buildDiscordPayMessage({
      amount: command.amount,
      checkoutUrl: "https://pay.pepepow.net/",
    });

    // This transport smoke is intentionally non-payment. Respond immediately
    // so Discord is never waiting on Payment Platform or another network hop.
    json(res, 200, {
      type: 4,
      data: {
        content:
          "PEPEW Discord transport smoke accepted. TEST ONLY — no payment invoice was created.",
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    });

    if (seenInteractions.has(command.interactionId)) {
      return;
    }
    seenInteractions.add(command.interactionId);

    const message = {
      ...paymentStyle,
      content:
        `PEPEW Discord merchant transport smoke\n` +
        `TEST ONLY — no Payment Platform invoice was created.\n` +
        `Requested test amount: ${command.amount} PEPEW`,
    };

    try {
      await createDiscordChannelMessage({
        token: config.botToken,
        channelId: command.channelId,
        message,
      });
    } catch (error) {
      if (!resolved) {
        resolved = true;
        finish.reject(error);
      }
      return;
    }

    console.log(
      "Discord transport smoke message sent with the PepewPay HTTPS link button.",
    );
    if (!resolved) {
      resolved = true;
      finish.resolve();
    }
  } catch (error) {
    if (error instanceof DiscordInteractionError) {
      res.writeHead(401, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    res.writeHead(500, { "Cache-Control": "no-store" });
    res.end();
    if (!resolved) {
      resolved = true;
      finish.reject(error);
    }
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(config.port, config.host, resolve);
});

console.log(
  `Discord interaction smoke listening on ${config.host}:${config.port}${config.path}`,
);
console.log("Waiting for Discord endpoint PING and one /pepew-pay command...");

const timeout = new Promise((_, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Discord transport smoke timed out.")),
    config.timeoutSeconds * 1000,
  );
  timer.unref?.();
});

try {
  await Promise.race([finished, timeout]);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
