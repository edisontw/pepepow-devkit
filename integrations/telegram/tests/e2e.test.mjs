import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  TELEGRAM_E2E_EVENT_TYPES,
  applyTelegramPaymentWebhook,
  buildTelegramStatusEdit,
  disableTemporaryWebhook,
  registerTemporaryWebhook,
} from "../src/e2e.mjs";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test("temporary webhook registration is filtered and keeps secret in return value only", async () => {
  let request;
  const result = await registerTemporaryWebhook({
    apiKey: "merchant-secret",
    url: "https://merchant.example/webhooks/pepew",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(201, {
        endpoint_id: "wh_abcdefgh",
        signing_secret: "signing-secret",
      });
    },
  });

  assert.equal(result.endpointId, "wh_abcdefgh");
  assert.equal(result.signingSecret, "signing-secret");
  assert.equal(request.url, "https://pay.pepepow.net/api/v1/webhook-endpoints");
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body.event_types, [...TELEGRAM_E2E_EVENT_TYPES]);
  assert.equal(request.init.headers.Authorization, "Bearer merchant-secret");
});

test("temporary webhook disable uses authenticated endpoint delete", async () => {
  let request;
  await disableTemporaryWebhook({
    apiKey: "merchant-secret",
    endpointId: "wh_abcdefgh",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(200, { ok: true });
    },
  });
  assert.equal(
    request.url,
    "https://pay.pepepow.net/api/v1/webhook-endpoints/wh_abcdefgh",
  );
  assert.equal(request.init.method, "DELETE");
});

test("status edit keeps the real PepewPay capability button", () => {
  const edit = buildTelegramStatusEdit({
    chatId: "123",
    messageId: "456",
    amount: "0.1",
    checkoutUrl: "https://pay.pepepow.net/?payment_id=pay_abcdefgh1234",
    decision: {
      apply: true,
      text: "PEPEW payment confirmed.",
    },
  });
  assert.equal(edit.chat_id, "123");
  assert.equal(edit.message_id, 456);
  assert.match(edit.text, /payment confirmed/);
  assert.match(
    edit.reply_markup.inline_keyboard[0][0].url,
    /^https:\/\/pay\.pepepow\.net\//,
  );
});

test("verified matching webhook edits Telegram exactly once", async () => {
  const signingSecret = "test-signing-secret";
  const timestamp = 1790697600;
  const event = {
    schema_version: 1,
    event_id: "evt_test",
    event_type: "payment.paid_confirmed",
    payment_id: "pay_abcdefgh1234",
    payment_version: 2,
    created_at: timestamp,
    data: {
      status: "paid_confirmed",
      merchant_reference: "tg:0123456789012345678901234567890123456789",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const signatureInput = Buffer.concat([
    Buffer.from(String(timestamp), "ascii"),
    Buffer.from("."),
    Buffer.from(event.event_id),
    Buffer.from("."),
    rawBody,
  ]);
  const signature =
    "v1=" + createHmac("sha256", signingSecret).update(signatureInput).digest("hex");

  const calls = [];
  const result = await applyTelegramPaymentWebhook({
    headers: {
      "X-PepewPay-Event-Id": event.event_id,
      "X-PepewPay-Delivery-Id": "dlv_test",
      "X-PepewPay-Timestamp": String(timestamp),
      "X-PepewPay-Signature": signature,
    },
    rawBody,
    signingSecret,
    expectedPaymentId: event.payment_id,
    expectedMerchantReference: event.data.merchant_reference,
    currentVersion: 1,
    telegramToken: "123456789:abcdefghijklmnopqrstuvwxyz",
    chatId: "123",
    messageId: "456",
    amount: "0.1",
    checkoutUrl: "https://pay.pepepow.net/?payment_id=pay_abcdefgh1234",
    nowSeconds: timestamp,
    apiCall: async (input) => {
      calls.push(input);
      return { message_id: 456 };
    },
  });

  assert.equal(result.ignored, false);
  assert.equal(result.decision.state, "paid");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "editMessageText");
});

test("verified event for another payment is acknowledged without Telegram update", async () => {
  const signingSecret = "test-signing-secret";
  const timestamp = 1790697600;
  const event = {
    schema_version: 1,
    event_id: "evt_other",
    event_type: "payment.paid_confirmed",
    payment_id: "pay_otherpayment123",
    payment_version: 2,
    created_at: timestamp,
    data: { status: "paid_confirmed" },
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const signatureInput = Buffer.concat([
    Buffer.from(String(timestamp), "ascii"),
    Buffer.from("."),
    Buffer.from(event.event_id),
    Buffer.from("."),
    rawBody,
  ]);
  const signature =
    "v1=" + createHmac("sha256", signingSecret).update(signatureInput).digest("hex");

  let called = false;
  const result = await applyTelegramPaymentWebhook({
    headers: {
      "X-PepewPay-Event-Id": event.event_id,
      "X-PepewPay-Delivery-Id": "dlv_other",
      "X-PepewPay-Timestamp": String(timestamp),
      "X-PepewPay-Signature": signature,
    },
    rawBody,
    signingSecret,
    expectedPaymentId: "pay_abcdefgh1234",
    expectedMerchantReference: "tg:expected",
    currentVersion: 1,
    telegramToken: "123456789:abcdefghijklmnopqrstuvwxyz",
    chatId: "123",
    messageId: "456",
    amount: "0.1",
    checkoutUrl: "https://pay.pepepow.net/?payment_id=pay_abcdefgh1234",
    nowSeconds: timestamp,
    apiCall: async () => {
      called = true;
    },
  });
  assert.equal(result.ignored, true);
  assert.equal(result.reason, "other_payment");
  assert.equal(called, false);
});
