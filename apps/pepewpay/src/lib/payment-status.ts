import { parsePepewAmount } from "@pepepow/pepew-js";

export const DEFAULT_PAYMENT_API_BASE_URL = "https://light.pepepow.net/api";
export const PAYMENT_STATUS_POLL_MS = 4_000;

export type PaymentStatusName =
  | "waiting"
  | "partial"
  | "paid_unconfirmed"
  | "paid_confirmed"
  | "overpaid"
  | "expired"
  | "error";

export interface PersistedPaymentStatus {
  ok: true;
  payment_id: string;
  address: string;
  amount: string;
  confirmations_required: number;
  created_at: number;
  created_height: number;
  expires_at: number;
  status: PaymentStatusName;
  version: number;
  received: string;
  confirmed: string;
  policy_confirmed: string;
  overpaid_by: string;
  label: string | null;
  message: string | null;
  updated_at: number;
}

export class PaymentStatusError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PaymentStatusError";
    this.code = code;
  }
}

const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9_-]{20,80}$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.\d{1,8})?$/;
const PAYMENT_STATUSES = new Set<PaymentStatusName>([
  "waiting",
  "partial",
  "paid_unconfirmed",
  "paid_confirmed",
  "overpaid",
  "expired",
  "error",
]);

export function assertPaymentId(paymentId: string): string {
  if (!PAYMENT_ID_PATTERN.test(paymentId)) {
    throw new PaymentStatusError("invalid_payment_id", "Payment link is invalid.");
  }
  return paymentId;
}

export function paymentIdFromSearch(search: string): string | undefined {
  const value = new URLSearchParams(search).get("payment_id")?.trim();
  if (!value) return undefined;
  return assertPaymentId(value);
}

export function paymentStatusShareUrl(paymentId: string, locationHref: string): string {
  const url = new URL(locationHref);
  url.search = "";
  url.hash = "";
  url.searchParams.set("payment_id", assertPaymentId(paymentId));
  return url.toString();
}

function exactDecimal(value: unknown, field: string): string {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new PaymentStatusError("invalid_response", `Invalid ${field} in payment status response.`);
  }
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new PaymentStatusError("invalid_response", `Invalid ${field} in payment status response.`);
  }
  return Number(value);
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new PaymentStatusError("invalid_response", `Invalid ${field} in payment status response.`);
  }
  return value;
}

export function parsePaymentStatusResponse(
  payload: unknown,
  expectedPaymentId: string,
): PersistedPaymentStatus {
  const paymentId = assertPaymentId(expectedPaymentId);
  if (!payload || typeof payload !== "object") {
    throw new PaymentStatusError("invalid_response", "Payment status response is invalid.");
  }

  const data = payload as Record<string, unknown>;
  if (data.ok !== true || data.payment_id !== paymentId) {
    throw new PaymentStatusError("invalid_response", "Payment status response does not match this checkout.");
  }

  if (typeof data.address !== "string" || !data.address) {
    throw new PaymentStatusError("invalid_response", "Payment status address is invalid.");
  }
  if (typeof data.status !== "string" || !PAYMENT_STATUSES.has(data.status as PaymentStatusName)) {
    throw new PaymentStatusError("invalid_response", "Payment status value is invalid.");
  }

  return {
    ok: true,
    payment_id: paymentId,
    address: data.address,
    amount: exactDecimal(data.amount, "amount"),
    confirmations_required: integer(data.confirmations_required, "confirmations_required"),
    created_at: integer(data.created_at, "created_at"),
    created_height: integer(data.created_height, "created_height"),
    expires_at: integer(data.expires_at, "expires_at"),
    status: data.status as PaymentStatusName,
    version: integer(data.version, "version", 1),
    received: exactDecimal(data.received, "received"),
    confirmed: exactDecimal(data.confirmed, "confirmed"),
    policy_confirmed: exactDecimal(data.policy_confirmed, "policy_confirmed"),
    overpaid_by: exactDecimal(data.overpaid_by, "overpaid_by"),
    label: nullableText(data.label, "label"),
    message: nullableText(data.message, "message"),
    updated_at: integer(data.updated_at, "updated_at"),
  };
}

export async function fetchPaymentStatus(
  paymentId: string,
  apiBaseUrl: string = DEFAULT_PAYMENT_API_BASE_URL,
  signal?: AbortSignal,
): Promise<PersistedPaymentStatus> {
  const checkedPaymentId = assertPaymentId(paymentId);
  const base = apiBaseUrl.replace(/\/+$/, "");
  const response = await fetch(
    `${base}/v1/payments/${encodeURIComponent(checkedPaymentId)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      signal,
    },
  );

  if (!response.ok) {
    let code = response.status === 404 ? "payment_not_found" : "payment_status_unavailable";
    try {
      const payload = await response.json() as { error?: { code?: unknown } };
      if (typeof payload.error?.code === "string") code = payload.error.code;
    } catch {
      // Keep the stable local error code when upstream returned a non-JSON body.
    }
    throw new PaymentStatusError(code, "Payment status is temporarily unavailable.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PaymentStatusError("invalid_response", "Payment status response is invalid.");
  }

  return parsePaymentStatusResponse(payload, checkedPaymentId);
}

function atomsAllowZero(amount: string): bigint {
  if (amount === "0") return 0n;
  return parsePepewAmount(amount);
}

export function paymentProgressPercent(payment: PersistedPaymentStatus): number {
  const requested = parsePepewAmount(payment.amount);
  const received = atomsAllowZero(payment.received);
  const basisPoints = received >= requested
    ? 10_000n
    : (received * 10_000n) / requested;
  return Number(basisPoints) / 100;
}

export function policySatisfied(payment: PersistedPaymentStatus): boolean {
  return atomsAllowZero(payment.policy_confirmed) >= parsePepewAmount(payment.amount);
}

export function paymentStatusPresentation(payment: PersistedPaymentStatus): {
  title: string;
  detail: string;
  tone: "pending" | "warning" | "success" | "expired";
} {
  switch (payment.status) {
    case "waiting":
      return {
        title: "Waiting for payment",
        detail: `No matching payment has been received yet. Requires ${payment.confirmations_required} confirmation${payment.confirmations_required === 1 ? "" : "s"}.`,
        tone: "pending",
      };
    case "partial":
      return {
        title: "Partial payment received",
        detail: `${payment.received} of ${payment.amount} PEPEW received.`,
        tone: "warning",
      };
    case "paid_unconfirmed":
      return {
        title: "Payment received",
        detail: `${payment.received} PEPEW received; waiting to satisfy the ${payment.confirmations_required}-confirmation policy.`,
        tone: "warning",
      };
    case "paid_confirmed":
      return {
        title: "Payment confirmed",
        detail: `${payment.policy_confirmed} PEPEW satisfies the ${payment.confirmations_required}-confirmation policy.`,
        tone: "success",
      };
    case "overpaid":
      return {
        title: "Overpayment detected",
        detail: policySatisfied(payment)
          ? `${payment.received} PEPEW received, ${payment.overpaid_by} PEPEW above the requested amount.`
          : `${payment.received} PEPEW received; confirmation policy is still pending.`,
        tone: policySatisfied(payment) ? "success" : "warning",
      };
    case "expired":
      return {
        title: "Payment expired",
        detail: payment.received === "0"
          ? "No qualifying payment was completed before the deadline."
          : `${payment.received} PEPEW was observed, but the payment did not complete before expiry.`,
        tone: "expired",
      };
    default:
      return {
        title: "Payment status unavailable",
        detail: "The persisted payment is currently in an error state.",
        tone: "warning",
      };
  }
}
