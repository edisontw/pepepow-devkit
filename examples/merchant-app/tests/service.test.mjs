import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MerchantTransportError } from "@pepepow/pepewpay-merchant";
import { MerchantStore } from "../src/store.mjs";
import {
  CreateUncertainError,
  createCheckout,
  stableIdempotencyKey,
} from "../src/service.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pepew-merchant-service-"));
  const store = new MerchantStore(join(dir, "merchant.sqlite3"));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return store;
}

function payment(version = 1, status = "waiting") {
  return {
    payment_id: "pay_abcdefgh",
    merchant_reference: "ORDER-1",
    version,
    status,
  };
}

test("stable idempotency identity is persisted before create and reused locally", async (t) => {
  const store = await fixture(t);
  let creates = 0;
  const merchantClient = {
    async createPayment(input) {
      creates += 1;
      assert.equal(input.idempotencyKey, stableIdempotencyKey("ORDER-1"));
      assert.ok(store.getOrder("ORDER-1"));
      return payment();
    },
  };

  const first = await createCheckout({
    store,
    merchantClient,
    orderId: "ORDER-1",
    receiveAddress: "PAddress",
    amount: "1.00",
    confirmations: 3,
    expiresIn: 900,
    checkoutBaseUrl: "https://pay.pepepow.net/",
    nowSeconds: 100,
  });
  const second = await createCheckout({
    store,
    merchantClient,
    orderId: "ORDER-1",
    receiveAddress: "PAddress",
    amount: "1.00",
    confirmations: 3,
    expiresIn: 900,
    checkoutBaseUrl: "https://pay.pepepow.net/",
    nowSeconds: 101,
  });

  assert.equal(creates, 1);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(first.checkoutUrl, second.checkoutUrl);
});

test("transport-loss create recovers by merchant_reference", async (t) => {
  const store = await fixture(t);
  const merchantClient = {
    async createPayment() {
      throw new MerchantTransportError("network_error");
    },
    async recoverPaymentByReference(reference) {
      assert.equal(reference, "ORDER-1");
      return payment(2, "paid_unconfirmed");
    },
  };

  const result = await createCheckout({
    store,
    merchantClient,
    orderId: "ORDER-1",
    receiveAddress: "PAddress",
    amount: "2.50",
    confirmations: 3,
    expiresIn: 900,
    checkoutBaseUrl: "https://pay.pepepow.net/",
    nowSeconds: 100,
  });

  assert.equal(result.order.paymentVersion, 2);
  assert.equal(result.order.paymentStatus, "paid_unconfirmed");
});

test("uncertain create keeps durable retry identity for a later safe retry", async (t) => {
  const store = await fixture(t);
  const merchantClient = {
    async createPayment() {
      throw new MerchantTransportError("timeout");
    },
    async recoverPaymentByReference() {
      return null;
    },
  };

  await assert.rejects(
    createCheckout({
      store,
      merchantClient,
      orderId: "ORDER-1",
      receiveAddress: "PAddress",
      amount: "3",
      confirmations: 3,
      expiresIn: 900,
      checkoutBaseUrl: "https://pay.pepepow.net/",
      nowSeconds: 100,
    }),
    CreateUncertainError,
  );

  const order = store.getOrder("ORDER-1");
  assert.equal(order.idempotencyKey, "create:ORDER-1:v1");
  assert.equal(order.paymentId, null);
});
