import { createHash } from "node:crypto";
import {
  MerchantTransportError,
  buildCheckoutUrl,
  isNewerPaymentVersion,
} from "@pepepow/pepewpay-merchant";

const TELEGRAM_ID_RE = /^-?(?:0|[1-9][0-9]{0,23})$/;
const MESSAGE_ID_RE = /^(?:0|[1-9][0-9]{0,15})$/;
const AMOUNT_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/;
const ATOMIC_RE = /^(?:0|[1-9][0-9]*)$/;

function normalizeId(value, label, pattern) {
  const text = String(value).trim();
  if (!pattern.test(text)) {
    throw new TypeError(`${label}_invalid`);
  }
  return text;
}

function normalizeAmount(value) {
  const text = String(value).trim();
  if (!AMOUNT_RE.test(text)) {
    throw new TypeError("amount_invalid");
  }
  const [whole, fraction = ""] = text.split(".");
  const atoms = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
  if (atoms <= 0n) {
    throw new TypeError("amount_invalid");
  }
  return text;
}

function normalizeAtomic(value, label) {
  const text = String(value ?? "").trim();
  if (!ATOMIC_RE.test(text)) {
    throw new TypeError(`${label}_invalid`);
  }
  return text.replace(/^0+(?=\d)/, "") || "0";
}

function atomicGte(left, right) {
  const a = normalizeAtomic(left, "atomic_left");
  const b = normalizeAtomic(right, "atomic_right");
  if (a.length !== b.length) return a.length > b.length;
  return a >= b;
}

function identityDigest({ botId, chatId, messageId }) {
  const bot = normalizeId(botId, "bot_id", TELEGRAM_ID_RE);
  const chat = normalizeId(chatId, "chat_id", TELEGRAM_ID_RE);
  const message = normalizeId(messageId, "message_id", MESSAGE_ID_RE);
  return createHash("sha256")
    .update(`telegram-payment-v1:${bot}:${chat}:${message}`, "utf8")
    .digest("hex")
    .slice(0, 40);
}

export function telegramMerchantReference(identity) {
  return `tg:${identityDigest(identity)}`;
}

export function telegramIdempotencyKey(identity) {
  return `tg:create:${identityDigest(identity)}:v1`;
}

export function buildTelegramPayMessage({ chatId, amount, checkoutUrl }) {
  const chat = normalizeId(chatId, "chat_id", TELEGRAM_ID_RE);
  const exactAmount = normalizeAmount(amount);
  const url = new URL(checkoutUrl);
  if (url.protocol !== "https:") {
    throw new TypeError("checkout_url_invalid");
  }

  return {
    chat_id: chat,
    text: `PEPEW payment request: ${exactAmount} PEPEW`,
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Pay with PEPEW",
            url: url.toString(),
          },
        ],
      ],
    },
  };
}

export async function createTelegramCheckout({
  merchantClient,
  receiveAddress,
  amount,
  botId,
  chatId,
  messageId,
  confirmations = 3,
  expiresIn = 900,
  checkoutBaseUrl = "https://pay.pepepow.net/",
}) {
  if (!merchantClient || typeof merchantClient.createPayment !== "function") {
    throw new TypeError("merchant_client_invalid");
  }
  const exactAmount = normalizeAmount(amount);
  const identity = { botId, chatId, messageId };
  const merchantReference = telegramMerchantReference(identity);
  const idempotencyKey = telegramIdempotencyKey(identity);

  let payment;
  try {
    payment = await merchantClient.createPayment({
      address: receiveAddress,
      amount: exactAmount,
      merchantReference,
      idempotencyKey,
      confirmations,
      expiresIn,
      label: "Telegram",
    });
  } catch (error) {
    if (
      !(error instanceof MerchantTransportError) ||
      typeof merchantClient.recoverPaymentByReference !== "function"
    ) {
      throw error;
    }
    payment = await merchantClient.recoverPaymentByReference(merchantReference);
    if (!payment) {
      throw error;
    }
  }

  if (payment.merchant_reference !== merchantReference) {
    throw new Error("telegram_payment_reference_mismatch");
  }

  const checkoutUrl = buildCheckoutUrl(payment.payment_id, checkoutBaseUrl);
  return {
    merchantReference,
    idempotencyKey,
    paymentId: payment.payment_id,
    paymentVersion: payment.version,
    paymentStatus: payment.status,
    checkoutUrl,
    sendMessage: buildTelegramPayMessage({
      chatId,
      amount: exactAmount,
      checkoutUrl,
    }),
  };
}

export function decideTelegramPaymentEvent({
  currentVersion,
  event,
}) {
  if (
    !event ||
    typeof event !== "object" ||
    !Number.isInteger(event.payment_version) ||
    !event.data ||
    typeof event.data !== "object" ||
    typeof event.data.status !== "string"
  ) {
    throw new TypeError("payment_event_invalid");
  }

  if (!isNewerPaymentVersion(currentVersion, event.payment_version)) {
    return { apply: false, reason: "stale_or_duplicate" };
  }

  const status = event.data.status;
  let confirmedForFulfillment = status === "paid_confirmed";

  if (status === "overpaid") {
    try {
      confirmedForFulfillment = atomicGte(
        event.data.policy_confirmed_sats,
        event.data.amount_sats,
      );
    } catch {
      confirmedForFulfillment = false;
    }
  }

  if (confirmedForFulfillment) {
    return {
      apply: true,
      paymentVersion: event.payment_version,
      paymentStatus: status,
      state: "paid",
      terminal: true,
      text: "PEPEW payment confirmed.",
    };
  }

  if (status === "expired" || status === "error") {
    return {
      apply: true,
      paymentVersion: event.payment_version,
      paymentStatus: status,
      state: "failed",
      terminal: true,
      text: status === "expired" ? "PEPEW payment expired." : "PEPEW payment requires review.",
    };
  }

  return {
    apply: true,
    paymentVersion: event.payment_version,
    paymentStatus: status,
    state: "pending",
    terminal: false,
    text: "PEPEW payment detected; waiting for required confirmations.",
  };
}
