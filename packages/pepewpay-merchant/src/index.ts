import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_PAYMENT_API_ORIGIN = "https://pay.pepepow.net";
export const DEFAULT_CHECKOUT_BASE_URL = "https://pay.pepepow.net/";
export const DEFAULT_WEBHOOK_REPLAY_WINDOW_SECONDS = 300;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export type PaymentStatus =
  | "waiting"
  | "seen_in_mempool"
  | "partial"
  | "paid_unconfirmed"
  | "paid_confirmed"
  | "overpaid"
  | "expired"
  | "error";

export interface MerchantPayment {
  ok: true;
  payment_id: string;
  address: string;
  amount: string;
  amount_sats: number;
  confirmations_required: number;
  created_at: number;
  created_height: number;
  expires_at: number;
  status: PaymentStatus | string;
  version: number;
  received: string;
  received_sats: number;
  confirmed: string;
  confirmed_sats: number;
  policy_confirmed: string;
  policy_confirmed_sats: number;
  overpaid_by: string;
  overpaid_by_sats: number;
  label: string | null;
  message: string | null;
  updated_at: number;
  merchant_reference: string | null;
  idempotency_key: string | null;
}

export interface CreatePaymentInput {
  address: string;
  amount: string;
  merchantReference: string;
  idempotencyKey: string;
  confirmations?: number;
  expiresIn?: number;
  label?: string;
  message?: string;
}

export interface MerchantPaymentListResponse {
  ok: true;
  payments: MerchantPayment[];
  has_more: boolean;
  next_before_created_at: number | null;
  next_before_payment_id: string | null;
}

export interface PaymentEventData {
  status: PaymentStatus | string;
  merchant_reference?: string | null;
  [key: string]: unknown;
}

export interface PaymentEventEnvelopeV1 {
  schema_version: 1;
  event_id: string;
  event_type: string;
  payment_id: string;
  payment_version: number;
  created_at: number;
  data: PaymentEventData;
}

export interface VerifyWebhookInput {
  headers: Headers | Record<string, string | undefined>;
  rawBody: Uint8Array;
  signingSecret: string;
  nowSeconds?: number;
  replayWindowSeconds?: number;
}

export class PepewMerchantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class MerchantApiError extends PepewMerchantError {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code = "merchant_api_error") {
    super(`PEPEW merchant API request failed with HTTP ${status}: ${code}`);
    this.status = status;
    this.code = code;
  }
}

export class MerchantTransportError extends PepewMerchantError {
  readonly code: string;

  constructor(code = "merchant_transport_error") {
    super(`PEPEW merchant API transport failed: ${code}`);
    this.code = code;
  }
}

export class WebhookVerificationError extends PepewMerchantError {
  readonly code: string;

  constructor(code: string) {
    super(`PEPEW webhook verification failed: ${code}`);
    this.code = code;
  }
}

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MERCHANT_REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const PAYMENT_ID_RE = /^pay_[A-Za-z0-9_-]{8,92}$/;
const SIGNATURE_RE = /^v1=[0-9a-f]{64}$/;

function requireHttpsUrl(value: string, field: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${field} must be a valid HTTPS URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new TypeError(
      `${field} must be HTTPS and must not contain credentials, query, or fragment`,
    );
  }
  return url;
}

export function validateMerchantReference(value: string): string {
  if (!MERCHANT_REFERENCE_RE.test(value)) {
    throw new TypeError(
      "merchantReference must be 1-128 characters using letters, digits, '.', '_', ':', '/', or '-'",
    );
  }
  return value;
}

export function validateIdempotencyKey(value: string): string {
  if (!IDEMPOTENCY_KEY_RE.test(value)) {
    throw new TypeError(
      "idempotencyKey must be 1-128 characters using letters, digits, '.', '_', ':', or '-'",
    );
  }
  return value;
}

export function validatePaymentId(value: string): string {
  if (!PAYMENT_ID_RE.test(value)) {
    throw new TypeError("paymentId does not match the PEPEW capability format");
  }
  return value;
}

export function buildCheckoutUrl(
  paymentId: string,
  checkoutBaseUrl = DEFAULT_CHECKOUT_BASE_URL,
): string {
  validatePaymentId(paymentId);
  const url = requireHttpsUrl(checkoutBaseUrl, "checkoutBaseUrl");
  url.searchParams.set("payment_id", paymentId);
  return url.toString();
}

function apiUrl(origin: string, path: string): string {
  const url = requireHttpsUrl(origin, "apiOrigin");
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function safeApiErrorCode(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "object" &&
    (value as { error?: unknown }).error !== null
  ) {
    const code = (value as { error: { code?: unknown } }).error.code;
    if (typeof code === "string" && code.length > 0) {
      return code.slice(0, 96);
    }
  }
  return "merchant_api_error";
}

function isMerchantPayment(value: unknown): value is MerchantPayment {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const payment = value as Partial<MerchantPayment>;
  return (
    payment.ok === true &&
    typeof payment.payment_id === "string" &&
    PAYMENT_ID_RE.test(payment.payment_id) &&
    typeof payment.status === "string" &&
    Number.isInteger(payment.version) &&
    typeof payment.merchant_reference !== "undefined"
  );
}

export interface MerchantClientOptions {
  apiKey: string;
  apiOrigin?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class MerchantClient {
  readonly apiOrigin: string;
  readonly timeoutMs: number;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(options: MerchantClientOptions) {
    if (!options.apiKey) {
      throw new TypeError("apiKey is required");
    }
    this.apiOrigin = requireHttpsUrl(
      options.apiOrigin ?? DEFAULT_PAYMENT_API_ORIGIN,
      "apiOrigin",
    ).origin;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError("timeoutMs must be positive");
    }
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async #request(
    method: "GET" | "POST",
    path: string,
    init: {
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${this.#apiKey}`,
        ...init.headers,
      };
      let body: string | undefined;
      if (typeof init.body !== "undefined") {
        body = JSON.stringify(init.body);
        headers["Content-Type"] = "application/json";
      }

      let response: Response;
      try {
        response = await this.#fetch(apiUrl(this.apiOrigin, path), {
          method,
          headers,
          body,
          signal: controller.signal,
        });
      } catch (error) {
        const code =
          error instanceof Error && error.name === "AbortError"
            ? "timeout"
            : "network_error";
        throw new MerchantTransportError(code);
      }

      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        throw new MerchantApiError(response.status || 502, "invalid_json_response");
      }

      if (!response.ok) {
        throw new MerchantApiError(response.status, safeApiErrorCode(payload));
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<MerchantPayment> {
    const merchantReference = validateMerchantReference(input.merchantReference);
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);

    const body: Record<string, unknown> = {
      address: input.address,
      amount: input.amount,
      merchant_reference: merchantReference,
    };
    if (typeof input.confirmations !== "undefined") {
      body.confirmations = input.confirmations;
    }
    if (typeof input.expiresIn !== "undefined") {
      body.expires_in = input.expiresIn;
    }
    if (typeof input.label !== "undefined") {
      body.label = input.label;
    }
    if (typeof input.message !== "undefined") {
      body.message = input.message;
    }

    const payload = await this.#request("POST", "/api/v1/payments", {
      body,
      headers: {
        "Idempotency-Key": idempotencyKey,
      },
    });
    if (!isMerchantPayment(payload)) {
      throw new MerchantApiError(502, "invalid_payment_response");
    }
    if (payload.merchant_reference !== merchantReference) {
      throw new MerchantApiError(502, "merchant_reference_mismatch");
    }
    return payload;
  }

  async recoverPaymentByReference(
    merchantReference: string,
  ): Promise<MerchantPayment | null> {
    const reference = validateMerchantReference(merchantReference);
    const query = new URLSearchParams({
      merchant_reference: reference,
      limit: "2",
    });
    const payload = await this.#request(
      "GET",
      `/api/v1/payments?${query.toString()}`,
    );

    if (
      typeof payload !== "object" ||
      payload === null ||
      !Array.isArray((payload as Partial<MerchantPaymentListResponse>).payments)
    ) {
      throw new MerchantApiError(502, "invalid_payment_list_response");
    }

    const payments = (payload as MerchantPaymentListResponse).payments;
    if (payments.length === 0) {
      return null;
    }
    if (payments.length !== 1 || !isMerchantPayment(payments[0])) {
      throw new MerchantApiError(502, "merchant_reference_not_unique");
    }
    if (payments[0].merchant_reference !== reference) {
      throw new MerchantApiError(502, "merchant_reference_mismatch");
    }
    return payments[0];
  }
}

function headerValue(
  headers: Headers | Record<string, string | undefined>,
  name: string,
): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === "string") {
      return value;
    }
  }
  return null;
}

function constantTimeSignatureEqual(expected: string, actual: string): boolean {
  if (!SIGNATURE_RE.test(actual)) {
    return false;
  }
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

function parseEventEnvelope(rawBody: Uint8Array): PaymentEventEnvelopeV1 {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(rawBody).toString("utf8"));
  } catch {
    throw new WebhookVerificationError("webhook_body_invalid");
  }
  if (typeof value !== "object" || value === null) {
    throw new WebhookVerificationError("webhook_body_invalid");
  }

  const event = value as Partial<PaymentEventEnvelopeV1>;
  if (event.schema_version !== 1) {
    throw new WebhookVerificationError("webhook_schema_unsupported");
  }
  if (
    typeof event.event_id !== "string" ||
    typeof event.event_type !== "string" ||
    typeof event.payment_id !== "string" ||
    !PAYMENT_ID_RE.test(event.payment_id) ||
    !Number.isInteger(event.payment_version) ||
    (event.payment_version ?? -1) < 0 ||
    typeof event.created_at !== "number" ||
    typeof event.data !== "object" ||
    event.data === null ||
    typeof (event.data as PaymentEventData).status !== "string"
  ) {
    throw new WebhookVerificationError("webhook_envelope_invalid");
  }

  const merchantReference = (event.data as PaymentEventData).merchant_reference;
  if (
    merchantReference !== undefined &&
    merchantReference !== null &&
    typeof merchantReference !== "string"
  ) {
    throw new WebhookVerificationError("webhook_merchant_reference_invalid");
  }

  return event as PaymentEventEnvelopeV1;
}

export function verifyWebhook(input: VerifyWebhookInput): PaymentEventEnvelopeV1 {
  if (!input.signingSecret) {
    throw new WebhookVerificationError("webhook_signing_secret_missing");
  }

  const replayWindowSeconds =
    input.replayWindowSeconds ?? DEFAULT_WEBHOOK_REPLAY_WINDOW_SECONDS;
  if (!Number.isInteger(replayWindowSeconds) || replayWindowSeconds < 1) {
    throw new TypeError("replayWindowSeconds must be a positive integer");
  }

  const eventId = headerValue(input.headers, "X-PepewPay-Event-Id");
  const deliveryId = headerValue(input.headers, "X-PepewPay-Delivery-Id");
  const timestampRaw = headerValue(input.headers, "X-PepewPay-Timestamp");
  const signature = headerValue(input.headers, "X-PepewPay-Signature");
  if (!eventId || !deliveryId || !timestampRaw || !signature) {
    throw new WebhookVerificationError("webhook_headers_missing");
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new WebhookVerificationError("webhook_timestamp_invalid");
  }
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(nowSeconds) ||
    Math.abs(nowSeconds - timestamp) > replayWindowSeconds
  ) {
    throw new WebhookVerificationError(
      "webhook_timestamp_outside_replay_window",
    );
  }

  const signatureInput = Buffer.concat([
    Buffer.from(String(timestamp), "ascii"),
    Buffer.from("."),
    Buffer.from(eventId, "utf8"),
    Buffer.from("."),
    Buffer.from(input.rawBody),
  ]);
  const expected =
    "v1=" +
    createHmac("sha256", input.signingSecret)
      .update(signatureInput)
      .digest("hex");

  if (!constantTimeSignatureEqual(expected, signature)) {
    throw new WebhookVerificationError("webhook_signature_invalid");
  }

  const event = parseEventEnvelope(input.rawBody);
  if (event.event_id !== eventId) {
    throw new WebhookVerificationError("webhook_event_id_mismatch");
  }
  return event;
}

export function isNewerPaymentVersion(
  currentVersion: number | null | undefined,
  incomingVersion: number,
): boolean {
  if (!Number.isInteger(incomingVersion) || incomingVersion < 0) {
    throw new TypeError("incomingVersion must be a non-negative integer");
  }
  if (currentVersion === null || typeof currentVersion === "undefined") {
    return true;
  }
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new TypeError("currentVersion must be a non-negative integer");
  }
  return incomingVersion > currentVersion;
}
