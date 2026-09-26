import { createServer } from "node:http";
import { resolve } from "node:path";
import {
  MerchantApiError,
  MerchantClient,
  MerchantTransportError,
  WebhookVerificationError,
  verifyWebhook,
} from "@pepepow/pepewpay-merchant";
import { MerchantStore, StoreConflictError } from "./src/store.mjs";
import {
  CreateUncertainError,
  createCheckout,
} from "./src/service.mjs";

const MAX_BODY_BYTES = 64 * 1024;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function responseHeaders() {
  return {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, responseHeaders());
  res.end(JSON.stringify(payload));
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error("body_too_large"), { code: "body_too_large" });
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

const config = {
  apiKey: requiredEnv("PEPEW_MERCHANT_API_KEY"),
  signingSecret: requiredEnv("PEPEW_WEBHOOK_SIGNING_SECRET"),
  receiveAddress: requiredEnv("PEPEW_RECEIVE_ADDRESS"),
  apiOrigin: process.env.PEPEW_PAYMENT_API_ORIGIN ?? "https://pay.pepepow.net",
  checkoutBaseUrl:
    process.env.PEPEW_CHECKOUT_BASE_URL ?? "https://pay.pepepow.net/",
  confirmations: positiveIntEnv("PEPEW_CONFIRMATIONS", 3),
  expiresIn: positiveIntEnv("PEPEW_EXPIRES_IN", 900),
  dbPath: resolve(process.env.MERCHANT_DB_PATH ?? "./data/merchant.sqlite3"),
  host: process.env.HOST ?? "127.0.0.1",
  port: positiveIntEnv("PORT", 3000),
};

const store = new MerchantStore(config.dbPath);
const merchantClient = new MerchantClient({
  apiKey: config.apiKey,
  apiOrigin: config.apiOrigin,
});

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/internal/orders") {
      const raw = await readRawBody(req);
      let body;
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid_json" });
        return;
      }

      const result = await createCheckout({
        store,
        merchantClient,
        orderId: body?.order_id,
        receiveAddress: config.receiveAddress,
        amount: body?.amount,
        confirmations: config.confirmations,
        expiresIn: config.expiresIn,
        checkoutBaseUrl: config.checkoutBaseUrl,
      });
      sendJson(res, result.reused ? 200 : 201, {
        ok: true,
        order_id: result.order.orderId,
        payment_status: result.order.paymentStatus,
        payment_version: result.order.paymentVersion,
        checkout_url: result.checkoutUrl,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/webhooks/pepew") {
      const rawBody = await readRawBody(req);
      const event = verifyWebhook({
        headers: normalizedHeaders(req.headers),
        rawBody,
        signingSecret: config.signingSecret,
      });
      const result = store.applyWebhookEvent(
        event,
        Math.floor(Date.now() / 1000),
      );
      if (result.outcome === "unknown_order") {
        sendJson(res, 409, { ok: false, error: "order_not_ready" });
        return;
      }
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }

    sendJson(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    if (error?.code === "body_too_large") {
      sendJson(res, 413, { ok: false, error: "body_too_large" });
    } else if (
      error instanceof TypeError ||
      error instanceof WebhookVerificationError
    ) {
      sendJson(res, 400, { ok: false, error: "invalid_request" });
    } else if (error instanceof StoreConflictError) {
      sendJson(res, 409, { ok: false, error: error.code });
    } else if (
      error instanceof CreateUncertainError ||
      error instanceof MerchantTransportError
    ) {
      sendJson(res, 503, { ok: false, error: "payment_service_unavailable" });
    } else if (error instanceof MerchantApiError) {
      sendJson(res, 502, { ok: false, error: "payment_api_error" });
    } else {
      sendJson(res, 500, { ok: false, error: "internal_error" });
    }
  }
});

server.listen(config.port, config.host, () => {
  console.log(`PEPEW merchant sample listening on ${config.host}:${config.port}`);
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
