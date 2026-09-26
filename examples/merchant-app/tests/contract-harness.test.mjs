import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MerchantClient, verifyWebhook } from '@pepepow/pepewpay-merchant';
import { MerchantStore } from '../src/store.mjs';
import { createCheckout } from '../src/service.mjs';
import { MockPaymentPlatform } from '../test-support/mock-payment-platform.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pepew-contract-'));
  const store = new MerchantStore(join(dir, 'merchant.sqlite3'));
  const platform = new MockPaymentPlatform();
  const merchantClient = new MerchantClient({ apiKey: platform.apiKey, apiOrigin: platform.origin, fetchImpl: platform.fetch });
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  return { store, platform, merchantClient };
}

function applySigned(store, platform, input) {
  const delivery = platform.signedWebhook(input);
  const event = verifyWebhook({ headers: delivery.headers, rawBody: delivery.rawBody, signingSecret: platform.webhookSecret, nowSeconds: delivery.nowSeconds });
  return store.applyWebhookEvent(event, delivery.nowSeconds);
}

test('contract harness covers lost-response recovery, duplicate webhook, and reorg rollback', async (t) => {
  const { store, platform, merchantClient } = await fixture(t);
  platform.failNextCreateAfterPersist();
  const checkout = await createCheckout({ store, merchantClient, orderId: 'ORDER-CONTRACT-1', receiveAddress: 'PContractAddress', amount: '1.00', confirmations: 3, expiresIn: 900, checkoutBaseUrl: 'https://pay.pepepow.net/', nowSeconds: 100 });
  assert.equal(platform.createCalls, 1);
  assert.equal(checkout.order.paymentStatus, 'waiting');
  assert.match(checkout.checkoutUrl, /payment_id=pay_mock00000001/);
  assert.equal(applySigned(store, platform, { merchantReference: 'ORDER-CONTRACT-1', version: 2, status: 'paid_unconfirmed', eventId: 'evt_contract_2' }).outcome, 'applied');
  assert.equal(applySigned(store, platform, { merchantReference: 'ORDER-CONTRACT-1', version: 3, status: 'paid_confirmed', eventId: 'evt_contract_3' }).outcome, 'applied');
  assert.equal(applySigned(store, platform, { merchantReference: 'ORDER-CONTRACT-1', version: 3, status: 'paid_confirmed', eventId: 'evt_contract_3' }).outcome, 'duplicate');
  assert.equal(applySigned(store, platform, { merchantReference: 'ORDER-CONTRACT-1', version: 4, status: 'paid_unconfirmed', eventId: 'evt_contract_4_reorg' }).outcome, 'applied');
  const order = store.getOrder('ORDER-CONTRACT-1');
  assert.equal(order.paymentVersion, 4);
  assert.equal(order.paymentStatus, 'paid_unconfirmed');
});

test('mock API enforces Payment API idempotency conflict semantics', async (t) => {
  const { merchantClient } = await fixture(t);
  const base = { address: 'PContractAddress', amount: '1.00', merchantReference: 'ORDER-CONTRACT-2', idempotencyKey: 'create:ORDER-CONTRACT-2:v1', confirmations: 3, expiresIn: 900 };
  const first = await merchantClient.createPayment(base);
  const replay = await merchantClient.createPayment(base);
  assert.equal(replay.payment_id, first.payment_id);
  await assert.rejects(merchantClient.createPayment({ ...base, amount: '2.00' }), (error) => error?.status === 409 && error?.code === 'payment_idempotency_conflict');
});
