import { verifyWebhook } from "@pepepow/pepewpay-merchant";
import { decideTelegramPaymentEvent } from "./index.mjs";
import { telegramApiCall } from "./transport.mjs";

export const TELEGRAM_E2E_EVENT_TYPES = Object.freeze([
  "payment.partial",
  "payment.paid_unconfirmed",
  "payment.paid_confirmed",
  "payment.overpaid",
  "payment.expired",
]);

function cleanHttpsOrigin(value, label) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new TypeError(`${label}_invalid`);
  }
  return url.origin;
}

function publicWebhookUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new TypeError("public_webhook_url_invalid");
  }
  return url.toString();
}

async function jsonOrNull(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function registerTemporaryWebhook({
  apiOrigin = "https://pay.pepepow.net",
  apiKey,
  url,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiKey) throw new TypeError("merchant_api_key_required");
  if (typeof fetchImpl !== "function") throw new TypeError("fetch_impl_invalid");
  const origin = cleanHttpsOrigin(apiOrigin.endsWith("/") ? apiOrigin : apiOrigin + "/", "payment_api_origin");
  const webhookUrl = publicWebhookUrl(url);

  const response = await fetchImpl(`${origin}/api/v1/webhook-endpoints`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: webhookUrl,
      event_types: [...TELEGRAM_E2E_EVENT_TYPES],
    }),
  });

  const payload = await jsonOrNull(response);
  if (
    !response.ok ||
    !payload ||
    typeof payload.endpoint_id !== "string" ||
    typeof payload.signing_secret !== "string"
  ) {
    throw new Error("telegram_e2e_webhook_registration_failed");
  }
  return {
    endpointId: payload.endpoint_id,
    signingSecret: payload.signing_secret,
  };
}

export async function disableTemporaryWebhook({
  apiOrigin = "https://pay.pepepow.net",
  apiKey,
  endpointId,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiKey) throw new TypeError("merchant_api_key_required");
  if (!endpointId) throw new TypeError("webhook_endpoint_id_required");
  if (typeof fetchImpl !== "function") throw new TypeError("fetch_impl_invalid");
  const origin = cleanHttpsOrigin(apiOrigin.endsWith("/") ? apiOrigin : apiOrigin + "/", "payment_api_origin");

  const response = await fetchImpl(
    `${origin}/api/v1/webhook-endpoints/${encodeURIComponent(endpointId)}`,
    {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error("telegram_e2e_webhook_disable_failed");
  }
}

function normalizeMessageId(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9][0-9]{0,15})$/.test(text)) {
    throw new TypeError("telegram_message_id_invalid");
  }
  return text;
}

function normalizeChatId(value) {
  const text = String(value ?? "").trim();
  if (!/^-?(?:0|[1-9][0-9]{0,23})$/.test(text)) {
    throw new TypeError("telegram_chat_id_invalid");
  }
  return text;
}

export function buildTelegramStatusEdit({
  chatId,
  messageId,
  amount,
  checkoutUrl,
  decision,
}) {
  if (!decision?.apply) throw new TypeError("payment_decision_invalid");
  const url = new URL(checkoutUrl);
  if (url.protocol !== "https:") throw new TypeError("checkout_url_invalid");

  return {
    chat_id: normalizeChatId(chatId),
    message_id: Number(normalizeMessageId(messageId)),
    text: [
      `PEPEW payment request: ${String(amount).trim()} PEPEW`,
      decision.text,
    ].join("\n"),
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [[{ text: "Open PepewPay", url: url.toString() }]],
    },
  };
}

export async function applyTelegramPaymentWebhook({
  headers,
  rawBody,
  signingSecret,
  expectedPaymentId,
  expectedMerchantReference,
  currentVersion,
  telegramToken,
  chatId,
  messageId,
  amount,
  checkoutUrl,
  apiCall = telegramApiCall,
  telegramApiEnvironment = "test",
  nowSeconds,
}) {
  const event = verifyWebhook({
    headers,
    rawBody,
    signingSecret,
    ...(typeof nowSeconds === "number" ? { nowSeconds } : {}),
  });

  if (event.payment_id !== expectedPaymentId) {
    return { ignored: true, reason: "other_payment", event };
  }
  if (
    event.data.merchant_reference != null &&
    event.data.merchant_reference !== expectedMerchantReference
  ) {
    return { ignored: true, reason: "merchant_reference_mismatch", event };
  }

  const decision = decideTelegramPaymentEvent({ currentVersion, event });
  if (!decision.apply) {
    return { ignored: true, reason: decision.reason, event, decision };
  }

  const edit = buildTelegramStatusEdit({
    chatId,
    messageId,
    amount,
    checkoutUrl,
    decision,
  });
  await apiCall({
    token: telegramToken,
    method: "editMessageText",
    body: edit,
    apiEnvironment: telegramApiEnvironment,
  });

  return { ignored: false, event, decision };
}
