import {
  buildCheckoutUrl,
  isNewerPaymentVersion,
  verifyWebhook,
} from "../../packages/pepewpay-merchant/dist/index.js";

/**
 * Reference composition only.
 *
 * merchantStore must be a durable application-owned store. This example does
 * not provide an in-memory fallback because order identity, create retries,
 * webhook deduplication, and fulfillment must survive process restarts.
 */
export async function createCheckout({
  merchantClient,
  merchantStore,
  orderId,
  idempotencyKey,
  address,
  amount,
}) {
  // 1. Persist business identity + stable retry identity first.
  await merchantStore.reserveCreate({
    orderId,
    idempotencyKey,
  });

  // 2. Perform the remote create only after the local reservation exists.
  const payment = await merchantClient.createPayment({
    address,
    amount,
    merchantReference: orderId,
    idempotencyKey,
  });

  // 3. Durably bind the PEPEW capability to the merchant order.
  await merchantStore.bindPayment(orderId, {
    paymentId: payment.payment_id,
    paymentVersion: payment.version,
    paymentStatus: payment.status,
  });

  // 4. Only this public capability URL is returned to the customer browser.
  return {
    paymentId: payment.payment_id,
    checkoutUrl: buildCheckoutUrl(payment.payment_id),
  };
}

export async function recoverCheckout({
  merchantClient,
  merchantStore,
  orderId,
}) {
  const payment = await merchantClient.recoverPaymentByReference(orderId);
  if (!payment) {
    return null;
  }

  await merchantStore.bindPayment(orderId, {
    paymentId: payment.payment_id,
    paymentVersion: payment.version,
    paymentStatus: payment.status,
  });

  return {
    paymentId: payment.payment_id,
    checkoutUrl: buildCheckoutUrl(payment.payment_id),
  };
}

export async function handleWebhook({
  headers,
  rawBody,
  signingSecret,
  merchantStore,
}) {
  // Verify HMAC/replay window before trusting parsed event data.
  const event = verifyWebhook({
    headers,
    rawBody,
    signingSecret,
  });

  // This operation must be one durable merchant-side transaction:
  // - reject/ignore an already-seen event_id
  // - find the order by payment_id or merchant_reference
  // - update state only when payment_version is newer
  // - record event_id as consumed only with the business-state decision
  return merchantStore.applyWebhookEvent(event, {
    shouldApplyVersion: isNewerPaymentVersion,
  });
}
