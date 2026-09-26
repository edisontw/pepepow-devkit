import { MerchantClient } from '@pepepow/pepewpay-merchant';

const CONFIRM = 'CREATE_ONE_EXPIRING_PAYMENT';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(name + ' is required');
  return value;
}

function maskPaymentId(value) {
  if (value.length <= 12) return 'pay_...';
  return value.slice(0, 8) + '...' + value.slice(-4);
}

if (process.env.PEPEW_LIVE_SMOKE_CONFIRM !== CONFIRM) {
  throw new Error('Refusing live write. Set PEPEW_LIVE_SMOKE_CONFIRM=' + CONFIRM + ' only for an intentional production smoke.');
}

const reference = required('PEPEW_LIVE_SMOKE_REFERENCE');
if (!/^SMOKE-[A-Za-z0-9._:-]{1,80}$/.test(reference)) {
  throw new Error('PEPEW_LIVE_SMOKE_REFERENCE must begin with SMOKE-');
}

const amount = required('PEPEW_LIVE_SMOKE_AMOUNT');
const address = required('PEPEW_RECEIVE_ADDRESS');
const apiKey = required('PEPEW_MERCHANT_API_KEY');
const apiOrigin = process.env.PEPEW_PAYMENT_API_ORIGIN ?? 'https://pay.pepepow.net';

const client = new MerchantClient({ apiKey, apiOrigin, timeoutMs: 10000 });
const payment = await client.createPayment({
  address,
  amount,
  merchantReference: reference,
  idempotencyKey: 'smoke:' + reference + ':v1',
  confirmations: 1,
  expiresIn: 300,
  label: 'PEPEW integration smoke',
});

const recovered = await client.recoverPaymentByReference(reference);
if (!recovered || recovered.payment_id !== payment.payment_id) throw new Error('Live smoke recovery mismatch');

const statusResponse = await fetch(apiOrigin.replace(/\/$/, '') + '/api/v1/payments/' + encodeURIComponent(payment.payment_id), {
  headers: { Accept: 'application/json' },
  signal: AbortSignal.timeout(10000),
});
if (!statusResponse.ok) throw new Error('Public status read failed with HTTP ' + statusResponse.status);
const status = await statusResponse.json();
if (status.payment_id !== payment.payment_id) throw new Error('Public capability status mismatch');

console.log('PEPEW live smoke passed.');
console.log('payment=' + maskPaymentId(payment.payment_id) + ' create_status=' + payment.status + ' public_status=' + status.status);
console.log('No payment was sent; the smoke invoice expires automatically.');
