import { describe, expect, it } from "vitest";

import {
  buildPaymentUri,
  buildWebWalletHandoffUrl,
  paymentInputFromSearch,
  paymentInputToShareUrl,
} from "./handoff";

const ADDRESS = "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb";

describe("PepewPay handoff", () => {
  it("uses the canonical Payment URI serializer", () => {
    expect(buildPaymentUri({
      address: ADDRESS,
      amount: "12.34000000",
      label: "Coffee Shop",
      message: "Order 1234",
    })).toBe(
      "pepew:PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb?amount=12.34&label=Coffee%20Shop&message=Order%201234",
    );
  });

  it("builds the existing web wallet send fallback without secrets", () => {
    expect(buildWebWalletHandoffUrl({
      address: ADDRESS,
      amount: "1.25",
      label: "Ignored by wallet fallback",
      message: "Ignored by wallet fallback",
    })).toBe(
      "https://light.pepepow.net/wallet/send?to=PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb&amount=1.25",
    );
  });

  it("loads public payment fields from the page URL", () => {
    expect(paymentInputFromSearch(
      "?address=PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb&amount=2&label=Demo&message=Order+1",
    )).toEqual({
      address: ADDRESS,
      amount: "2",
      label: "Demo",
      message: "Order 1",
    });
  });

  it("creates a shareable HTTPS page URL with public intent only", () => {
    expect(paymentInputToShareUrl(
      { address: ADDRESS, amount: "2", label: "Demo", message: "Order 1" },
      "https://pay.example.test/checkout/?old=value#fragment",
    )).toBe(
      "https://pay.example.test/checkout/?address=PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb&amount=2&label=Demo&message=Order+1",
    );
  });
});
