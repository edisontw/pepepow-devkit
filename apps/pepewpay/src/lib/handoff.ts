import { formatPaymentUri, type PaymentUriInput } from "@pepepow/pepew-js";

export const DEFAULT_WEB_WALLET_URL = "https://wallet.pepepow.net/send";

export function buildPaymentUri(input: PaymentUriInput): string {
  return formatPaymentUri(input);
}

export function buildWebWalletHandoffUrl(
  input: PaymentUriInput,
  walletUrl: string = DEFAULT_WEB_WALLET_URL,
): string {
  const base = new URL(walletUrl);
  base.searchParams.set("to", input.address);

  if (input.amount) {
    base.searchParams.set("amount", input.amount);
  }

  return base.toString();
}

export function paymentInputFromSearch(search: string): PaymentUriInput {
  const params = new URLSearchParams(search);
  return {
    address: params.get("address")?.trim() ?? "",
    amount: params.get("amount")?.trim() || undefined,
    label: params.get("label") ?? undefined,
    message: params.get("message") ?? undefined,
  };
}

export function paymentInputToShareUrl(input: PaymentUriInput, locationHref: string): string {
  const url = new URL(locationHref);
  url.search = "";
  url.hash = "";
  url.searchParams.set("address", input.address);

  if (input.amount) url.searchParams.set("amount", input.amount);
  if (input.label) url.searchParams.set("label", input.label);
  if (input.message) url.searchParams.set("message", input.message);

  return url.toString();
}
