import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  MerchantApiError,
  MerchantClient,
  WebhookVerificationError,
  buildCheckoutUrl,
  isNewerPaymentVersion,
  verifyWebhook,
} from "../dist/index.js";

function payment(overrides = {}) {
  return {
    ok: true,
    payment_id: "pay_abcdefgh1234",
    address: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
    amount: "12.34",
    amount_sats: 1234000000,
    confirmations_required: 3,
    created_at: 1760000000,
    created_height: 5000000,
    expires_at: 1760000900,
    status: "waiting",
    version: 1,
    received: "0",
    received_sats: 0,
    confirmed: "0",
    confirmed_sats: 0,
    policy_confirmed: "0",
    policy_confirmed_sats: 0,
    overpaid_by: "0",
    overpaid_by_sats: 0,
    label: null,
    message: null,
    updated_at: 1760000000,
    merchant_reference: "ORDER-1234",
    idempotency_key: "create:ORDER-1234:v1",
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function signedWebhook({
  eventId = "evt_test",
  paymentId = "pay_abcdefgh1234",
  version = 2,
  status = "paid_confirmed",
  merchantReference = "ORDER-1234",
  timestamp = 1760000000,
  secret = "endpoint-secret",
} = {}) {
  const event = {
    schema_version: 1,
    event_id: eventId,
    event_type: `payment.${status}`,
    payment_id: paymentId,
    payment_version: version,
    created_at: timestamp,
    data: {
      status,
      merchant_reference: merchantReference,
    },
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const signatureInput = Buffer.concat([
    Buffer.from(String(timestamp), "ascii"),
    Buffer.from("."),
    Buffer.from(eventId),
    Buffer.from("."),
    rawBody,
  ]);
  const signature =
    "v1=" +
    createHmac("sha256", secret).update(signatureInput).digest("hex");

  return {
    event,
    rawBody,
    secret,
    headers: {
      "X-PepewPay-Event-Id": eventId,
      "X-PepewPay-Delivery-Id": "dlv_test",
      "X-PepewPay-Timestamp": String(timestamp),
      "X-PepewPay-Signature": signature,
    },
  };
}

test("checkout URL contains only the public payment capability", () => {
  const url = new URL(
    buildCheckoutUrl(
      "pay_abcdefgh1234",
      "https://light.pepepow.net/pay/",
    ),
  );

  assert.equal(url.origin, "https://light.pepepow.net");
  assert.equal(url.pathname, "/pay/");
  assert.deepEqual([...url.searchParams.entries()], [
    ["payment_id", "pay_abcdefgh1234"],
  ]);
});

test("createPayment keeps merchant credentials in server-side headers", async () => {
  let captured;
  const client = new MerchantClient({
    apiKey: "merchant-secret-key",
    apiOrigin: "https://pay.example",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return jsonResponse(payment(), 201);
    },
  });

  const result = await client.createPayment({
    address: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
    amount: "12.34",
    merchantReference: "ORDER-1234",
    idempotencyKey: "create:ORDER-1234:v1",
    confirmations: 3,
    expiresIn: 900,
  });

  assert.equal(result.payment_id, "pay_abcdefgh1234");
  assert.equal(captured.url, "https://pay.example/api/v1/payments");

  const headers = new Headers(captured.init.headers);
  assert.equal(headers.get("authorization"), "Bearer merchant-secret-key");
  assert.equal(headers.get("idempotency-key"), "create:ORDER-1234:v1");

  const body = JSON.parse(captured.init.body);
  assert.equal(body.merchant_reference, "ORDER-1234");
  assert.equal(body.expires_in, 900);
  assert.equal(body.confirmations, 3);
  assert.equal(captured.init.body.includes("merchant-secret-key"), false);
});

test("recoverPaymentByReference uses exact authenticated reference lookup", async () => {
  let captured;
  const client = new MerchantClient({
    apiKey: "merchant-secret-key",
    apiOrigin: "https://pay.example",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return jsonResponse({
        ok: true,
        payments: [payment({ merchant_reference: "ORDER/1234" })],
        has_more: false,
        next_before_created_at: null,
        next_before_payment_id: null,
      });
    },
  });

  const result = await client.recoverPaymentByReference("ORDER/1234");
  const url = new URL(captured.url);

  assert.equal(result.payment_id, "pay_abcdefgh1234");
  assert.equal(url.pathname, "/api/v1/payments");
  assert.equal(url.searchParams.get("merchant_reference"), "ORDER/1234");
  assert.equal(url.searchParams.get("limit"), "2");

  const headers = new Headers(captured.init.headers);
  assert.equal(headers.get("authorization"), "Bearer merchant-secret-key");
});

test("recoverPaymentByReference returns null when no payment exists", async () => {
  const client = new MerchantClient({
    apiKey: "merchant-secret-key",
    fetchImpl: async () =>
      jsonResponse({
        ok: true,
        payments: [],
        has_more: false,
        next_before_created_at: null,
        next_before_payment_id: null,
      }),
  });

  assert.equal(await client.recoverPaymentByReference("ORDER-404"), null);
});

test("merchant API failures expose bounded error code without response-body echo", async () => {
  const client = new MerchantClient({
    apiKey: "merchant-secret-key",
    fetchImpl: async () =>
      jsonResponse(
        {
          ok: false,
          error: {
            code: "payment_idempotency_conflict",
            message: "internal detail should not be copied into the SDK error",
          },
        },
        409,
      ),
  });

  await assert.rejects(
    () =>
      client.createPayment({
        address: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
        amount: "12.34",
        merchantReference: "ORDER-1234",
        idempotencyKey: "create:ORDER-1234:v1",
      }),
    (error) => {
      assert.equal(error instanceof MerchantApiError, true);
      assert.equal(error.status, 409);
      assert.equal(error.code, "payment_idempotency_conflict");
      assert.equal(error.message.includes("internal detail"), false);
      return true;
    },
  );
});

test("verifyWebhook authenticates exact raw body bytes", () => {
  const fixture = signedWebhook();

  const event = verifyWebhook({
    headers: fixture.headers,
    rawBody: fixture.rawBody,
    signingSecret: fixture.secret,
    nowSeconds: 1760000020,
  });

  assert.equal(event.event_id, "evt_test");
  assert.equal(event.payment_version, 2);
  assert.equal(event.data.status, "paid_confirmed");
});

test("verifyWebhook rejects body tampering before trusting JSON", () => {
  const fixture = signedWebhook();
  const tampered = Buffer.from(
    fixture.rawBody.toString("utf8").replace("paid_confirmed", "partial"),
  );

  assert.throws(
    () =>
      verifyWebhook({
        headers: fixture.headers,
        rawBody: tampered,
        signingSecret: fixture.secret,
        nowSeconds: 1760000020,
      }),
    (error) =>
      error instanceof WebhookVerificationError &&
      error.code === "webhook_signature_invalid",
  );
});

test("verifyWebhook rejects timestamps outside the replay window", () => {
  const fixture = signedWebhook();

  assert.throws(
    () =>
      verifyWebhook({
        headers: fixture.headers,
        rawBody: fixture.rawBody,
        signingSecret: fixture.secret,
        nowSeconds: 1760000301,
        replayWindowSeconds: 300,
      }),
    (error) =>
      error instanceof WebhookVerificationError &&
      error.code === "webhook_timestamp_outside_replay_window",
  );
});

test("verifyWebhook checks that signed header event id matches the envelope", () => {
  const fixture = signedWebhook();
  const event = JSON.parse(fixture.rawBody.toString("utf8"));
  event.event_id = "evt_other";
  const rawBody = Buffer.from(JSON.stringify(event));

  const signatureInput = Buffer.concat([
    Buffer.from("1760000000.evt_test."),
    rawBody,
  ]);
  const signature =
    "v1=" +
    createHmac("sha256", fixture.secret)
      .update(signatureInput)
      .digest("hex");

  assert.throws(
    () =>
      verifyWebhook({
        headers: {
          ...fixture.headers,
          "X-PepewPay-Signature": signature,
        },
        rawBody,
        signingSecret: fixture.secret,
        nowSeconds: 1760000020,
      }),
    (error) =>
      error instanceof WebhookVerificationError &&
      error.code === "webhook_event_id_mismatch",
  );
});

test("payment version helper applies later reorg events without status ranking", () => {
  assert.equal(isNewerPaymentVersion(null, 1), true);
  assert.equal(isNewerPaymentVersion(2, 3), true);
  assert.equal(isNewerPaymentVersion(3, 2), false);
  assert.equal(isNewerPaymentVersion(3, 3), false);
});
