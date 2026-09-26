import {
  MerchantTransportError,
  buildCheckoutUrl,
} from "@pepepow/pepewpay-merchant";

export class CreateUncertainError extends Error {
  constructor() {
    super("payment_create_uncertain");
    this.name = "CreateUncertainError";
    this.code = "payment_create_uncertain";
  }
}

const ORDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const AMOUNT_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;

export function validateOrderId(value) {
  if (typeof value !== "string" || !ORDER_ID_RE.test(value)) {
    throw new TypeError("order_id_invalid");
  }
  return value;
}

export function validateAmount(value) {
  if (typeof value !== "string" || !AMOUNT_RE.test(value)) {
    throw new TypeError("amount_invalid");
  }
  const [whole, fraction = ""] = value.split(".");
  const atoms = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
  if (atoms <= 0n) {
    throw new TypeError("amount_invalid");
  }
  return value;
}

export function stableIdempotencyKey(orderId) {
  validateOrderId(orderId);
  return `create:${orderId}:v1`;
}

export async function createCheckout({
  store,
  merchantClient,
  orderId,
  receiveAddress,
  amount,
  confirmations,
  expiresIn,
  checkoutBaseUrl,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const reference = validateOrderId(orderId);
  const exactAmount = validateAmount(amount);
  const idempotencyKey = stableIdempotencyKey(reference);

  let order = store.reserveOrder({
    orderId: reference,
    idempotencyKey,
    receiveAddress,
    amount: exactAmount,
    nowSeconds,
  });

  if (order.paymentId) {
    return {
      order,
      checkoutUrl: buildCheckoutUrl(order.paymentId, checkoutBaseUrl),
      reused: true,
    };
  }

  let payment;
  try {
    payment = await merchantClient.createPayment({
      address: receiveAddress,
      amount: exactAmount,
      merchantReference: reference,
      idempotencyKey,
      confirmations,
      expiresIn,
    });
  } catch (error) {
    if (!(error instanceof MerchantTransportError)) {
      throw error;
    }
    payment = await merchantClient.recoverPaymentByReference(reference);
    if (!payment) {
      throw new CreateUncertainError();
    }
  }

  order = store.bindPayment(reference, payment, nowSeconds);
  return {
    order,
    checkoutUrl: buildCheckoutUrl(payment.payment_id, checkoutBaseUrl),
    reused: false,
  };
}
