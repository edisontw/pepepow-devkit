import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MerchantStore } from "../src/store.mjs";

async function withStore(t) {
  const dir = await mkdtemp(join(tmpdir(), "pepew-merchant-store-"));
  const path = join(dir, "merchant.sqlite3");
  const store = new MerchantStore(path);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { store, path };
}

function event({
  eventId,
  version,
  status,
  reference = "ORDER-1",
  paymentId = "pay_abcdefgh",
}) {
  return {
    schema_version: 1,
    event_id: eventId,
    event_type: "payment.updated",
    payment_id: paymentId,
    payment_version: version,
    created_at: 100,
    data: { status, merchant_reference: reference },
  };
}

test("unknown webhook is not consumed and can be retried after order reservation", async (t) => {
  const { store } = await withStore(t);
  const pending = event({ eventId: "evt-1", version: 1, status: "paid_unconfirmed" });

  assert.equal(store.applyWebhookEvent(pending, 100).outcome, "unknown_order");
  assert.equal(store.hasProcessedEvent("evt-1"), false);

  store.reserveOrder({
    orderId: "ORDER-1",
    idempotencyKey: "create:ORDER-1:v1",
    receiveAddress: "PAddress",
    amount: "1.00",
    nowSeconds: 101,
  });
  assert.equal(store.applyWebhookEvent(pending, 102).outcome, "applied");
  assert.equal(store.hasProcessedEvent("evt-1"), true);
});

test("webhook dedup and payment_version ordering survive backward reorg states", async (t) => {
  const { store } = await withStore(t);
  store.reserveOrder({
    orderId: "ORDER-1",
    idempotencyKey: "create:ORDER-1:v1",
    receiveAddress: "PAddress",
    amount: "1.00",
    nowSeconds: 100,
  });

  assert.equal(
    store.applyWebhookEvent(
      event({ eventId: "evt-5", version: 5, status: "paid_confirmed" }),
      105,
    ).outcome,
    "applied",
  );
  assert.equal(
    store.applyWebhookEvent(
      event({ eventId: "evt-6", version: 6, status: "paid_unconfirmed" }),
      106,
    ).outcome,
    "applied",
  );
  assert.equal(store.getOrder("ORDER-1").paymentStatus, "paid_unconfirmed");
  assert.equal(store.getOrder("ORDER-1").paymentVersion, 6);

  assert.equal(
    store.applyWebhookEvent(
      event({ eventId: "evt-stale", version: 4, status: "paid_confirmed" }),
      107,
    ).outcome,
    "stale",
  );
  assert.equal(store.getOrder("ORDER-1").paymentVersion, 6);
  assert.equal(
    store.applyWebhookEvent(
      event({ eventId: "evt-6", version: 6, status: "paid_unconfirmed" }),
      108,
    ).outcome,
    "duplicate",
  );
});

test("late create response cannot overwrite a newer webhook race", async (t) => {
  const { store } = await withStore(t);
  store.reserveOrder({
    orderId: "ORDER-1",
    idempotencyKey: "create:ORDER-1:v1",
    receiveAddress: "PAddress",
    amount: "1.00",
    nowSeconds: 100,
  });

  store.applyWebhookEvent(
    event({ eventId: "evt-race", version: 2, status: "paid_unconfirmed" }),
    102,
  );

  store.bindPayment(
    "ORDER-1",
    {
      payment_id: "pay_abcdefgh",
      merchant_reference: "ORDER-1",
      version: 1,
      status: "waiting",
    },
    103,
  );

  const order = store.getOrder("ORDER-1");
  assert.equal(order.paymentId, "pay_abcdefgh");
  assert.equal(order.paymentVersion, 2);
  assert.equal(order.paymentStatus, "paid_unconfirmed");
});
