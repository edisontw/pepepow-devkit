import { createHmac } from 'node:crypto';

export const MOCK_API_ORIGIN = 'https://mock.pay.pepepow.test';
export const MOCK_API_KEY = 'test_api_key_0123456789_abcdef_0123456789';
export const MOCK_WEBHOOK_SECRET = 'test_webhook_secret_0123456789_abcdef';

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function header(init, name) {
  return new Headers(init?.headers ?? {}).get(name);
}

export class MockPaymentPlatform {
  constructor() {
    this.origin = MOCK_API_ORIGIN;
    this.apiKey = MOCK_API_KEY;
    this.webhookSecret = MOCK_WEBHOOK_SECRET;
    this.nextPayment = 1;
    this.createCalls = 0;
    this.paymentsByReference = new Map();
    this.idempotency = new Map();
    this.failAfterPersist = false;
  }

  failNextCreateAfterPersist() { this.failAfterPersist = true; }

  fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin !== this.origin) throw new Error('mock_origin_mismatch');
    if (url.pathname !== '/api/v1/payments/' && header(init, 'Authorization') !== 'Bearer ' + this.apiKey) {
      return jsonResponse(401, { error: { code: 'payment_auth_required' } });
    }
    if (init.method === 'POST' && url.pathname === '/api/v1/payments') return this.#create(init);
    if ((init.method ?? 'GET') === 'GET' && url.pathname === '/api/v1/payments') {
      const reference = url.searchParams.get('merchant_reference');
      const payment = reference ? this.paymentsByReference.get(reference) ?? null : null;
      return jsonResponse(200, { ok: true, payments: payment ? [payment] : [], has_more: false, next_before_created_at: null, next_before_payment_id: null });
    }
    if ((init.method ?? 'GET') === 'GET' && url.pathname.startsWith('/api/v1/payments/')) {
      const paymentId = url.pathname.slice('/api/v1/payments/'.length);
      const payment = [...this.paymentsByReference.values()].find((value) => value.payment_id === paymentId);
      return payment ? jsonResponse(200, payment) : jsonResponse(404, { error: { code: 'payment_not_found' } });
    }
    return jsonResponse(404, { error: { code: 'not_found' } });
  };

  async #create(init) {
    this.createCalls += 1;
    const body = JSON.parse(init.body ?? '{}');
    const idempotencyKey = header(init, 'Idempotency-Key');
    const normalized = JSON.stringify(body);
    const existing = this.idempotency.get(idempotencyKey);
    if (existing) {
      if (existing.normalized !== normalized) return jsonResponse(409, { error: { code: 'payment_idempotency_conflict' } });
      return jsonResponse(200, existing.payment);
    }
    if (this.paymentsByReference.has(body.merchant_reference)) return jsonResponse(409, { error: { code: 'payment_merchant_reference_conflict' } });
    const createdAt = 1800000000 + this.nextPayment;
    const payment = {
      ok: true, payment_id: 'pay_mock' + String(this.nextPayment).padStart(8, '0'),
      address: body.address, amount: body.amount, amount_sats: 100000000,
      confirmations_required: body.confirmations ?? 3, created_at: createdAt, created_height: 4500000,
      expires_at: createdAt + (body.expires_in ?? 900), status: 'waiting', version: 1,
      received: '0', received_sats: 0, confirmed: '0', confirmed_sats: 0,
      policy_confirmed: '0', policy_confirmed_sats: 0, overpaid_by: '0', overpaid_by_sats: 0,
      label: body.label ?? null, message: body.message ?? null, updated_at: createdAt,
      merchant_reference: body.merchant_reference, idempotency_key: idempotencyKey,
    };
    this.nextPayment += 1;
    this.paymentsByReference.set(body.merchant_reference, payment);
    this.idempotency.set(idempotencyKey, { normalized, payment });
    if (this.failAfterPersist) { this.failAfterPersist = false; throw new TypeError('simulated_transport_loss_after_persist'); }
    return jsonResponse(201, payment);
  }

  signedWebhook({ merchantReference, version, status, eventId }) {
    const payment = this.paymentsByReference.get(merchantReference);
    if (!payment) throw new Error('mock_payment_missing');
    const event = { schema_version: 1, event_id: eventId, event_type: 'payment.' + status, payment_id: payment.payment_id, payment_version: version, created_at: 1800000100 + version, data: { status, merchant_reference: merchantReference } };
    const rawBody = Buffer.from(JSON.stringify(event));
    const timestamp = event.created_at;
    const signatureInput = Buffer.concat([Buffer.from(String(timestamp), 'ascii'), Buffer.from('.'), Buffer.from(eventId, 'utf8'), Buffer.from('.'), rawBody]);
    const signature = 'v1=' + createHmac('sha256', this.webhookSecret).update(signatureInput).digest('hex');
    return { event, rawBody, nowSeconds: timestamp, headers: {
      'X-PepewPay-Event-Id': eventId, 'X-PepewPay-Delivery-Id': 'dlv_' + eventId,
      'X-PepewPay-Timestamp': String(timestamp), 'X-PepewPay-Signature': signature,
    } };
  }
}
