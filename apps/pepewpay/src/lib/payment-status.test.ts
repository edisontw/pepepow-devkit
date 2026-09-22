import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PAYMENT_API_BASE_URL,
  fetchPaymentStatus,
  paymentIdFromSearch,
  paymentProgressPercent,
  paymentStatusPresentation,
  paymentStatusShareUrl,
  policySatisfied,
} from "./payment-status";

const PAYMENT_ID = "pay_AAAAAAAAAAAAAAAAAAAAAAAA";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    payment_id: PAYMENT_ID,
    address: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
    amount: "1.25",
    confirmations_required: 3,
    created_at: 1000,
    created_height: 500,
    expires_at: 1900,
    status: "partial",
    version: 2,
    received: "0.5",
    confirmed: "0",
    policy_confirmed: "0",
    overpaid_by: "0",
    label: "Demo",
    message: "Order 1",
    updated_at: 1100,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("persisted payment status", () => {
  it("extracts and validates capability payment id", () => {
    expect(paymentIdFromSearch(`?payment_id=${PAYMENT_ID}`)).toBe(PAYMENT_ID);
    expect(() => paymentIdFromSearch("?payment_id=pay_short")).toThrow();
  });

  it("creates a share URL containing only the capability id", () => {
    expect(paymentStatusShareUrl(
      PAYMENT_ID,
      "https://pay.example.test/checkout/?address=old#fragment",
    )).toBe(
      `https://pay.example.test/checkout/?payment_id=${PAYMENT_ID}`,
    );
  });

  it("fetches status with GET and no browser credentials", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe("GET");
      expect(init.credentials).toBe("omit");
      expect(init.cache).toBe("no-store");
      expect(init.headers).toEqual({ Accept: "application/json" });
      expect(init.headers).not.toHaveProperty("Authorization");
      return new Response(JSON.stringify(payload()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPaymentStatus(PAYMENT_ID, "https://light.example/api/");

    expect(result.payment_id).toBe(PAYMENT_ID);
    expect(result.received).toBe("0.5");
    expect(fetchMock).toHaveBeenCalledWith(
      `https://light.example/api/v1/payments/${PAYMENT_ID}`,
      expect.any(Object),
    );
  });



  it("defaults persisted status reads to the same-origin API path", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(`/api/v1/payments/${PAYMENT_ID}`);
      return new Response(JSON.stringify(payload()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(DEFAULT_PAYMENT_API_BASE_URL).toBe("/api");
    await fetchPaymentStatus(PAYMENT_ID);
  });

  it("uses exact decimal strings for progress math", () => {
    const payment = payload() as any;
    expect(paymentProgressPercent(payment)).toBe(40);
    expect(policySatisfied(payment)).toBe(false);

    const confirmed = payload({
      status: "paid_confirmed",
      received: "1.25",
      confirmed: "1.25",
      policy_confirmed: "1.25",
    }) as any;
    expect(paymentProgressPercent(confirmed)).toBe(100);
    expect(policySatisfied(confirmed)).toBe(true);
  });

  it("presents confirmation policy without inventing a current confirmation count", () => {
    const payment = payload({
      status: "paid_unconfirmed",
      received: "1.25",
    }) as any;
    const presentation = paymentStatusPresentation(payment);

    expect(presentation.title).toBe("Payment received");
    expect(presentation.detail).toContain("3-confirmation policy");
  });

  it("maps missing payment to a stable error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ ok: false, error: { code: "payment_not_found" } }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    )));

    await expect(
      fetchPaymentStatus(PAYMENT_ID, "https://light.example/api"),
    ).rejects.toMatchObject({ code: "payment_not_found" });
  });
});
