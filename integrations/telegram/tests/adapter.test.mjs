import assert from "node:assert/strict";
import test from "node:test";
import { MerchantTransportError } from "@pepepow/pepewpay-merchant";
import {
  buildTelegramPayMessage,
  createTelegramCheckout,
  decideTelegramPaymentEvent,
  telegramIdempotencyKey,
  telegramMerchantReference,
} from "../src/index.mjs";

const identity = {
  botId: "123456789",
  chatId: "-1009876543210",
  messageId: "42",
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

test("Telegram order identity is stable and does not expose raw Telegram IDs", () => {
  const reference = telegramMerchantReference(identity);
  const key = telegramIdempotencyKey(identity);

  assert.match(reference, /^tg:[0-9a-f]{40}$/);
  assert.match(key, /^tg:create:[0-9a-f]{40}:v1$/);
  assert.equal(reference, telegramMerchantReference(identity));
  assert.equal(key, telegramIdempotencyKey(identity));
  assert.equal(reference.includes(identity.chatId), false);
  assert.equal(reference.includes(identity.messageId), false);
});

test("checkout uses stable identity and returns a Telegram inline URL button", async () => {
  const calls = [];
  const merchantClient = {
    async createPayment(input) {
      calls.push(input);
      return payment(input.merchantReference);
    },
  };

  const result = await createTelegramCheckout({
    merchantClient,
    receiveAddress: "PExample",
    amount: "0.10",
    ...identity,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].merchantReference, telegramMerchantReference(identity));
  assert.equal(calls[0].idempotencyKey, telegramIdempotencyKey(identity));
  assert.equal(calls[0].label, "Telegram");
  assert.equal(result.sendMessage.chat_id, identity.chatId);
  assert.equal(
    result.sendMessage.reply_markup.inline_keyboard[0][0].url,
    result.checkoutUrl,
  );
  assert.match(result.checkoutUrl, /^https:\/\/pay\.pepepow\.net\/\?payment_id=/);
});

test("transport loss recovers the exact Telegram merchant reference", async () => {
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

  const result = await createTelegramCheckout({
    merchantClient,
    receiveAddress: "PExample",
    amount: "1.25",
    ...identity,
  });

  assert.equal(recoveredReference, telegramMerchantReference(identity));
  assert.equal(result.paymentVersion, 2);
  assert.equal(result.paymentStatus, "paid_unconfirmed");
});

test("Telegram pay message rejects non-HTTPS checkout URLs", () => {
  assert.throws(
    () =>
      buildTelegramPayMessage({
        chatId: identity.chatId,
        amount: "1",
        checkoutUrl: "http://example.invalid/pay",
      }),
    /checkout_url_invalid/,
  );
});

test("stale payment versions are ignored", () => {
  const decision = decideTelegramPaymentEvent({
    currentVersion: 5,
    event: {
      payment_version: 5,
      data: { status: "paid_confirmed" },
    },
  });
  assert.deepEqual(decision, { apply: false, reason: "stale_or_duplicate" });
});

test("paid_confirmed is terminal paid", () => {
  const decision = decideTelegramPaymentEvent({
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

test("unconfirmed overpayment does not bypass confirmation policy", () => {
  const pending = decideTelegramPaymentEvent({
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

  const confirmed = decideTelegramPaymentEvent({
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

test("expired payment becomes terminal failed", () => {
  const decision = decideTelegramPaymentEvent({
    currentVersion: 1,
    event: {
      payment_version: 2,
      data: { status: "expired" },
    },
  });
  assert.equal(decision.state, "failed");
  assert.equal(decision.terminal, true);
});
