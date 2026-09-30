import { verifyWebhook } from "@pepepow/pepewpay-merchant";
import { editDiscordChannelMessage } from "./bot-api.mjs";
import { decideDiscordPaymentEvent } from "./index.mjs";

export const DISCORD_E2E_EVENT_TYPES = Object.freeze([
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
    throw new TypeError(label + "_invalid");
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

export async function registerTemporaryDiscordWebhook({
  apiOrigin = "https://pay.pepepow.net",
  apiKey,
  url,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiKey) throw new TypeError("merchant_api_key_required");
  if (typeof fetchImpl !== "function") throw new TypeError("fetch_impl_invalid");
  const origin = cleanHttpsOrigin(
    apiOrigin.endsWith("/") ? apiOrigin : apiOrigin + "/",
    "payment_api_origin",
  );
  const webhookUrl = publicWebhookUrl(url);

  const response = await fetchImpl(origin + "/api/v1/webhook-endpoints", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: webhookUrl,
      event_types: [...DISCORD_E2E_EVENT_TYPES],
    }),
  });

  const payload = await jsonOrNull(response);
  if (
    !response.ok ||
    !payload ||
    typeof payload.endpoint_id !== "string" ||
    typeof payload.signing_secret !== "string"
  ) {
    throw new Error("discord_e2e_webhook_registration_failed");
  }
  return {
    endpointId: payload.endpoint_id,
    signingSecret: payload.signing_secret,
  };
}

export async function disableTemporaryDiscordWebhook({
  apiOrigin = "https://pay.pepepow.net",
  apiKey,
  endpointId,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiKey) throw new TypeError("merchant_api_key_required");
  if (!endpointId) throw new TypeError("webhook_endpoint_id_required");
  if (typeof fetchImpl !== "function") throw new TypeError("fetch_impl_invalid");
  const origin = cleanHttpsOrigin(
    apiOrigin.endsWith("/") ? apiOrigin : apiOrigin + "/",
    "payment_api_origin",
  );

  const response = await fetchImpl(
    origin + "/api/v1/webhook-endpoints/" + encodeURIComponent(endpointId),
    {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + apiKey,
      },
    },
  );
  if (!response.ok) {
    throw new Error("discord_e2e_webhook_disable_failed");
  }
}

export function buildDiscordStatusEdit({ amount, checkoutUrl, decision }) {
  if (!decision?.apply) throw new TypeError("payment_decision_invalid");
  const url = new URL(checkoutUrl);
  if (url.protocol !== "https:") throw new TypeError("checkout_url_invalid");

  return {
    content: [
      "PEPEW payment request: " + String(amount).trim() + " PEPEW",
      decision.content,
    ].join("\n"),
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "Open PepewPay",
            url: url.toString(),
          },
        ],
      },
    ],
  };
}

export async function applyDiscordPaymentWebhook({
  headers,
  rawBody,
  signingSecret,
  expectedPaymentId,
  expectedMerchantReference,
  currentVersion,
  discordToken,
  channelId,
  messageId,
  amount,
  checkoutUrl,
  editMessage = editDiscordChannelMessage,
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

  const decision = decideDiscordPaymentEvent({ currentVersion, event });
  if (!decision.apply) {
    return { ignored: true, reason: decision.reason, event, decision };
  }

  const message = buildDiscordStatusEdit({
    amount,
    checkoutUrl,
    decision,
  });
  await editMessage({
    token: discordToken,
    channelId,
    messageId,
    message,
  });

  return { ignored: false, event, decision };
}
