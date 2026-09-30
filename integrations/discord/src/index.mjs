import { createHash } from "node:crypto";
import {
  MerchantTransportError,
  buildCheckoutUrl,
  isNewerPaymentVersion,
} from "@pepepow/pepewpay-merchant";

const DISCORD_ID_RE = /^[1-9][0-9]{0,19}$/;
const AMOUNT_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/;
const ATOMIC_RE = /^(?:0|[1-9][0-9]*)$/;

function normalizeId(value, label) {
  const text = String(value ?? "").trim();
  if (!DISCORD_ID_RE.test(text)) {
    throw new TypeError(`${label}_invalid`);
  }
  return text;
}

function normalizeAmount(value) {
  const text = String(value ?? "").trim();
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

function identityDigest({ applicationId, channelId, interactionId }) {
  const application = normalizeId(applicationId, "application_id");
  const channel = normalizeId(channelId, "channel_id");
  const interaction = normalizeId(interactionId, "interaction_id");
  return createHash("sha256")
    .update(
      `discord-payment-v1:${application}:${channel}:${interaction}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 40);
}

export function discordMerchantReference(identity) {
  return `dc:${identityDigest(identity)}`;
}

export function discordIdempotencyKey(identity) {
  return `dc:create:${identityDigest(identity)}:v1`;
}

export function buildDiscordPayMessage({ amount, checkoutUrl }) {
  const exactAmount = normalizeAmount(amount);
  const url = new URL(checkoutUrl);
  if (url.protocol !== "https:") {
    throw new TypeError("checkout_url_invalid");
  }

  return {
    content: `PEPEW payment request: ${exactAmount} PEPEW`,
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "Pay with PEPEW",
            url: url.toString(),
          },
        ],
      },
    ],
  };
}

export async function createDiscordCheckout({
  merchantClient,
  receiveAddress,
  amount,
  applicationId,
  channelId,
  interactionId,
  confirmations = 3,
  expiresIn = 900,
  checkoutBaseUrl = "https://pay.pepepow.net/",
}) {
  if (!merchantClient || typeof merchantClient.createPayment !== "function") {
    throw new TypeError("merchant_client_invalid");
  }

  const exactAmount = normalizeAmount(amount);
  const identity = { applicationId, channelId, interactionId };
  const merchantReference = discordMerchantReference(identity);
  const idempotencyKey = discordIdempotencyKey(identity);

  let payment;
  try {
    payment = await merchantClient.createPayment({
      address: receiveAddress,
      amount: exactAmount,
      merchantReference,
      idempotencyKey,
      confirmations,
      expiresIn,
      label: "Discord",
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
    throw new Error("discord_payment_reference_mismatch");
  }

  const checkoutUrl = buildCheckoutUrl(payment.payment_id, checkoutBaseUrl);
  return {
    merchantReference,
    idempotencyKey,
    paymentId: payment.payment_id,
    paymentVersion: payment.version,
    paymentStatus: payment.status,
    checkoutUrl,
    createMessage: buildDiscordPayMessage({
      amount: exactAmount,
      checkoutUrl,
    }),
  };
}

export function decideDiscordPaymentEvent({ currentVersion, event }) {
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
      content: "PEPEW payment confirmed.",
    };
  }

  if (status === "expired" || status === "error") {
    return {
      apply: true,
      paymentVersion: event.payment_version,
      paymentStatus: status,
      state: "failed",
      terminal: true,
      content:
        status === "expired"
          ? "PEPEW payment expired."
          : "PEPEW payment requires review.",
    };
  }

  return {
    apply: true,
    paymentVersion: event.payment_version,
    paymentStatus: status,
    state: "pending",
    terminal: false,
    content: "PEPEW payment detected; waiting for required confirmations.",
  };
}
