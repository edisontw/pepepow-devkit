import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MerchantClient } from "../dist/index.js";

const fixture = JSON.parse(
  await readFile(
    new URL("../../../test-vectors/merchant-namespaces-v1.json", import.meta.url),
    "utf8",
  ),
);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function payment(id, reference, idempotencyKey) {
  return {
    ok: true,
    payment_id: id,
    address: fixture.shared.address,
    amount: fixture.shared.amount,
    amount_sats: 125000000,
    confirmations_required: 3,
    created_at: 1800000000,
    created_height: 5000000,
    expires_at: 1800000900,
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
    updated_at: 1800000000,
    merchant_reference: reference,
    idempotency_key: idempotencyKey,
  };
}

function createScopedFixtureFetch() {
  const byCredential = new Map(
    fixture.merchants.map((merchant) => [
      merchant.api_key,
      {
        merchant,
        byReference: new Map(),
        byIdempotency: new Map(),
      },
    ]),
  );

  return async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const headers = new Headers(init.headers);
    const authorization = headers.get("authorization");
    const credential = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : null;
    const namespace = credential ? byCredential.get(credential) : null;

    if (!namespace) {
      return jsonResponse(
        { ok: false, error: { code: "payment_auth_required" } },
        401,
      );
    }

    if (init.method === "POST" && url.pathname === "/api/v1/payments") {
      const body = JSON.parse(init.body ?? "{}");
      const idempotencyKey = headers.get("idempotency-key");
      const existing = namespace.byIdempotency.get(idempotencyKey);
      if (existing) {
        return jsonResponse(existing, 201);
      }
      const created = payment(
        namespace.merchant.expected_payment_id,
        body.merchant_reference,
        idempotencyKey,
      );
      namespace.byReference.set(body.merchant_reference, created);
      namespace.byIdempotency.set(idempotencyKey, created);
      return jsonResponse(created, 201);
    }

    if ((init.method ?? "GET") === "GET" && url.pathname === "/api/v1/payments") {
      const reference = url.searchParams.get("merchant_reference");
      const found = namespace.byReference.get(reference);
      return jsonResponse({
        ok: true,
        payments: found ? [found] : [],
        has_more: false,
        next_before_created_at: null,
        next_before_payment_id: null,
      });
    }

    return jsonResponse({ ok: false, error: { code: "not_found" } }, 404);
  };
}

test("Phase K scoped credentials keep identical merchant identities isolated", async () => {
  const fetchImpl = createScopedFixtureFetch();
  const [merchantA, merchantB] = fixture.merchants.map(
    (merchant) =>
      new MerchantClient({
        apiKey: merchant.api_key,
        apiOrigin: "https://pay.contract.test",
        fetchImpl,
      }),
  );

  const input = {
    address: fixture.shared.address,
    amount: fixture.shared.amount,
    merchantReference: fixture.shared.merchant_reference,
    idempotencyKey: fixture.shared.idempotency_key,
  };

  const [paymentA, paymentB] = await Promise.all([
    merchantA.createPayment(input),
    merchantB.createPayment(input),
  ]);

  assert.equal(paymentA.payment_id, fixture.merchants[0].expected_payment_id);
  assert.equal(paymentB.payment_id, fixture.merchants[1].expected_payment_id);
  assert.notEqual(paymentA.payment_id, paymentB.payment_id);

  const recoveredA = await merchantA.recoverPaymentByReference(
    fixture.shared.merchant_reference,
  );
  const recoveredB = await merchantB.recoverPaymentByReference(
    fixture.shared.merchant_reference,
  );

  assert.equal(recoveredA.payment_id, paymentA.payment_id);
  assert.equal(recoveredB.payment_id, paymentB.payment_id);

  const replayA = await merchantA.createPayment(input);
  const replayB = await merchantB.createPayment(input);
  assert.equal(replayA.payment_id, paymentA.payment_id);
  assert.equal(replayB.payment_id, paymentB.payment_id);
});
