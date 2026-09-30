import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  DISCORD_E2E_EVENT_TYPES,
  applyDiscordPaymentWebhook,
  buildDiscordStatusEdit,
  disableTemporaryDiscordWebhook,
  registerTemporaryDiscordWebhook,
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

function signedEvent({ signingSecret, event, timestamp }) {
  const rawBody = Buffer.from(JSON.stringify(event));
  const signatureInput = Buffer.concat([
    Buffer.from(String(timestamp), "ascii"),
    Buffer.from("."),
    Buffer.from(event.event_id),
    Buffer.from("."),
    rawBody,
  ]);
  const signature =
    "v1=" +
    createHmac("sha256", signingSecret).update(signatureInput).digest("hex");
  return {
    rawBody,
    headers: {
      "X-PepewPay-Event-Id": event.event_id,
      "X-PepewPay-Delivery-Id": "dlv_test",
      "X-PepewPay-Timestamp": String(timestamp),
      "X-PepewPay-Signature": signature,
    },
  };
}

test("temporary Discord webhook registration is filtered", async () => {
  let request;
  const result = await registerTemporaryDiscordWebhook({
    apiKey: "merchant-secret",
    url: "https://merchant.example/pepew-discord-e2e/webhooks/pepew",
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
  assert.deepEqual(body.event_types, [...DISCORD_E2E_EVENT_TYPES]);
  assert.equal(request.init.headers.Authorization, "Bearer merchant-secret");
});

test("temporary Discord webhook disable uses authenticated delete", async () => {
  let request;
  await disableTemporaryDiscordWebhook({
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

test("Discord status edit preserves the real PepewPay capability button", () => {
  const edit = buildDiscordStatusEdit({
    amount: "0.1",
    checkoutUrl: "https://pay.pepepow.net/?payment_id=pay_abcdefgh1234",
    decision: {
      apply: true,
      content: "PEPEW payment confirmed.",
    },
  });

  assert.match(edit.content, /payment confirmed/);
  assert.deepEqual(edit.allowed_mentions, { parse: [] });
  assert.match(
    edit.components[0].components[0].url,
    /^https:\/\/pay\.pepepow\.net\//,
  );
});

test("verified matching webhook edits the same Discord message", async () => {
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
      merchant_reference: "dc:0123456789012345678901234567890123456789",
    },
  };
  const signed = signedEvent({ signingSecret, event, timestamp });

  const calls = [];
  const result = await applyDiscordPaymentWebhook({
    headers: signed.headers,
    rawBody: signed.rawBody,
    signingSecret,
    expectedPaymentId: event.payment_id,
    expectedMerchantReference: event.data.merchant_reference,
    currentVersion: 1,
    discordToken: "test.discord.bot.token.value.123456789",
    channelId: "1423456789012345678",
    messageId: "1456789012345678901",
    amount: "0.1",
    checkoutUrl: "https://pay.pepepow.net/?payment_id=pay_abcdefgh1234",
    nowSeconds: timestamp,
    editMessage: async (input) => {
      calls.push(input);
      return {
        id: input.messageId,
        channel_id: input.channelId,
      };
    },
  });

  assert.equal(result.ignored, false);
  assert.equal(result.decision.state, "paid");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channelId, "1423456789012345678");
  assert.equal(calls[0].messageId, "1456789012345678901");
  assert.match(calls[0].message.content, /payment confirmed/);
});

test("stale verified webhook does not edit Discord", async () => {
  const signingSecret = "test-signing-secret";
  const timestamp = 1790697600;
  const event = {
    schema_version: 1,
    event_id: "evt_stale",
    event_type: "payment.paid_unconfirmed",
    payment_id: "pay_abcdefgh1234",
    payment_version: 1,
    created_at: timestamp,
    data: {
      status: "paid_unconfirmed",
      merchant_reference: "dc:0123456789012345678901234567890123456789",
    },
  };
  const signed = signedEvent({ signingSecret, event, timestamp });

  let called = false;
  const result = await applyDiscordPaymentWebhook({
    headers: signed.headers,
    rawBody: signed.rawBody,
    signingSecret,
    expectedPaymentId: event.payment_id,
    expectedMerchantReference: event.data.merchant_reference,
    currentVersion: 2,
    discordToken: "test.discord.bot.token.value.123456789",
    channelId: "1423456789012345678",
    messageId: "1456789012345678901",
    amount: "0.1",
    checkoutUrl: "https://pay.pepepow.net/?payment_id=pay_abcdefgh1234",
    nowSeconds: timestamp,
    editMessage: async () => {
      called = true;
    },
  });

  assert.equal(result.ignored, true);
  assert.equal(result.reason, "stale_or_duplicate");
  assert.equal(called, false);
});

test("verified event for another payment is acknowledged without Discord edit", async () => {
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
  const signed = signedEvent({ signingSecret, event, timestamp });

  let called = false;
  const result = await applyDiscordPaymentWebhook({
    headers: signed.headers,
    rawBody: signed.rawBody,
    signingSecret,
    expectedPaymentId: "pay_abcdefgh1234",
    expectedMerchantReference: "dc:expected",
    currentVersion: 1,
    discordToken: "test.discord.bot.token.value.123456789",
    channelId: "1423456789012345678",
    messageId: "1456789012345678901",
    amount: "0.1",
    checkoutUrl: "https://pay.pepepow.net/?payment_id=pay_abcdefgh1234",
    nowSeconds: timestamp,
    editMessage: async () => {
      called = true;
    },
  });

  assert.equal(result.ignored, true);
  assert.equal(result.reason, "other_payment");
  assert.equal(called, false);
});
