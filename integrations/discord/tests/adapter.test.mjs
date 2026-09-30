import assert from "node:assert/strict";
import test from "node:test";
import { MerchantTransportError } from "@pepepow/pepewpay-merchant";
import {
  buildDiscordPayMessage,
  createDiscordCheckout,
  decideDiscordPaymentEvent,
  discordIdempotencyKey,
  discordMerchantReference,
} from "../src/index.mjs";

const identity = {
  applicationId: "1412345678901234567",
  channelId: "1423456789012345678",
  interactionId: "1434567890123456789",
};

function payment(reference, overrides = {}) {
  return {
    payment_id: "pay_abcdefgh1234",
    merchant_reference: reference,
    version: 1,
    status: "waiting",
    ...overrides,
  };
}

test("Discord payment identity is stable and does not expose raw Discord IDs", () => {
  const reference = discordMerchantReference(identity);
  const key = discordIdempotencyKey(identity);

  assert.match(reference, /^dc:[0-9a-f]{40}$/);
  assert.match(key, /^dc:create:[0-9a-f]{40}:v1$/);
  assert.equal(reference, discordMerchantReference(identity));
  assert.equal(key, discordIdempotencyKey(identity));

  for (const raw of Object.values(identity)) {
    assert.equal(reference.includes(raw), false);
    assert.equal(key.includes(raw), false);
  }
});

test("checkout uses stable identity and returns a Discord link button", async () => {
  const calls = [];
  const merchantClient = {
    async createPayment(input) {
      calls.push(input);
      return payment(input.merchantReference);
    },
  };

  const result = await createDiscordCheckout({
    merchantClient,
    receiveAddress: "PExample",
    amount: "0.10",
    ...identity,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].merchantReference, discordMerchantReference(identity));
  assert.equal(calls[0].idempotencyKey, discordIdempotencyKey(identity));
  assert.equal(calls[0].label, "Discord");
  assert.equal(result.createMessage.allowed_mentions.parse.length, 0);
  assert.equal(result.createMessage.components[0].components[0].style, 5);
  assert.equal(
    result.createMessage.components[0].components[0].url,
    result.checkoutUrl,
  );
  assert.match(
    result.checkoutUrl,
    /^https:\/\/pay\.pepepow\.net\/\?payment_id=/,
  );
});

test("transport loss recovers the exact Discord merchant reference", async () => {
  let recoveredReference = null;
  const merchantClient = {
    async createPayment() {
      throw new MerchantTransportError("network_error");
    },
    async recoverPaymentByReference(reference) {
      recoveredReference = reference;
      return payment(reference, { version: 2, status: "paid_unconfirmed" });
    },
  };

  const result = await createDiscordCheckout({
    merchantClient,
    receiveAddress: "PExample",
    amount: "1.25",
    ...identity,
  });

  assert.equal(recoveredReference, discordMerchantReference(identity));
  assert.equal(result.paymentVersion, 2);
  assert.equal(result.paymentStatus, "paid_unconfirmed");
});

test("Discord pay message rejects non-HTTPS checkout URLs", () => {
  assert.throws(
    () =>
      buildDiscordPayMessage({
        amount: "1",
        checkoutUrl: "http://example.invalid/pay",
      }),
    /checkout_url_invalid/,
  );
});

test("Discord pay message suppresses mentions", () => {
  const message = buildDiscordPayMessage({
    amount: "0.1",
    checkoutUrl: "https://pay.pepepow.net/?payment_id=pay_abcdefgh1234",
  });
  assert.deepEqual(message.allowed_mentions, { parse: [] });
});

test("stale Discord payment versions are ignored", () => {
  const decision = decideDiscordPaymentEvent({
    currentVersion: 5,
    event: {
      payment_version: 5,
      data: { status: "paid_confirmed" },
    },
  });
  assert.deepEqual(decision, { apply: false, reason: "stale_or_duplicate" });
});

test("Discord paid_confirmed is terminal paid", () => {
  const decision = decideDiscordPaymentEvent({
    currentVersion: 1,
    event: {
      payment_version: 2,
      data: { status: "paid_confirmed" },
    },
  });
  assert.equal(decision.apply, true);
  assert.equal(decision.state, "paid");
  assert.equal(decision.terminal, true);
});

test("Discord unconfirmed overpayment does not bypass confirmation policy", () => {
  const pending = decideDiscordPaymentEvent({
    currentVersion: 1,
    event: {
      payment_version: 2,
      data: {
        status: "overpaid",
        amount_sats: "10000000",
        policy_confirmed_sats: "0",
      },
    },
  });
  assert.equal(pending.state, "pending");
  assert.equal(pending.terminal, false);

  const confirmed = decideDiscordPaymentEvent({
    currentVersion: 2,
    event: {
      payment_version: 3,
      data: {
        status: "overpaid",
        amount_sats: "10000000",
        policy_confirmed_sats: "10000000",
      },
    },
  });
  assert.equal(confirmed.state, "paid");
  assert.equal(confirmed.terminal, true);
});

test("Discord expired payment becomes terminal failed", () => {
  const decision = decideDiscordPaymentEvent({
    currentVersion: 1,
    event: {
      payment_version: 2,
      data: { status: "expired" },
    },
  });
  assert.equal(decision.state, "failed");
  assert.equal(decision.terminal, true);
});
