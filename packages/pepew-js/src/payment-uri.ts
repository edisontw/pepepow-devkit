import { assertPepewAddress } from "./address.js";
import { canonicalizePepewAmount, parsePepewAmount } from "./amount.js";
import { PEPEW_URI_SCHEME } from "./constants.js";

const KNOWN_PARAMETERS = new Set(["amount", "label", "message"]);
const PARAMETER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;

export class PaymentUriError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PaymentUriError";
    this.code = code;
  }
}

export interface PaymentUriInput {
  address: string;
  amount?: string;
  label?: string;
  message?: string;
  extras?: Readonly<Record<string, string>>;
}

export interface ParsedPaymentUri extends PaymentUriInput {
  amountSats?: bigint;
}

function decodeQueryComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    throw new PaymentUriError("invalid_percent_encoding", "Payment URI contains invalid percent-encoding.");
  }
}

function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function validateParameterName(name: string): void {
  if (!PARAMETER_NAME_PATTERN.test(name)) {
    throw new PaymentUriError("invalid_parameter_name", `Invalid Payment URI parameter name: ${name}`);
  }

  const lower = name.toLowerCase();
  if (KNOWN_PARAMETERS.has(lower) && name !== lower) {
    throw new PaymentUriError(
      "invalid_parameter_name",
      `Known Payment URI parameter names are lowercase: ${lower}`,
    );
  }

  if (lower.startsWith("req-")) {
    throw new PaymentUriError(
      "unsupported_required_parameter",
      `Unsupported required Payment URI parameter: ${name}`,
    );
  }
}

function normalizeOptionalText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new PaymentUriError("invalid_parameter", `${field} must be a string.`);
  }
  return value;
}

export function parsePaymentUri(uri: string): ParsedPaymentUri {
  if (typeof uri !== "string" || !uri) {
    throw new PaymentUriError("invalid_uri", "Payment URI must be a non-empty string.");
  }

  if (uri.includes("#")) {
    throw new PaymentUriError("fragment_not_allowed", "Payment URI fragments are not allowed.");
  }

  const colonIndex = uri.indexOf(":");
  if (colonIndex <= 0) {
    throw new PaymentUriError("invalid_scheme", "Payment URI scheme is missing.");
  }

  const scheme = uri.slice(0, colonIndex);
  if (scheme.toLowerCase() !== PEPEW_URI_SCHEME) {
    throw new PaymentUriError("invalid_scheme", `Expected ${PEPEW_URI_SCHEME}: URI scheme.`);
  }

  const remainder = uri.slice(colonIndex + 1);
  if (remainder.startsWith("//")) {
    throw new PaymentUriError("authority_not_allowed", "Payment URI must not contain an authority component.");
  }

  const queryIndex = remainder.indexOf("?");
  const address = queryIndex >= 0 ? remainder.slice(0, queryIndex) : remainder;
  const rawQuery = queryIndex >= 0 ? remainder.slice(queryIndex + 1) : "";

  if (!address || address.includes("/") || address.includes("%")) {
    throw new PaymentUriError("invalid_address", "Payment URI must contain a literal PEPEW address.");
  }

  try {
    assertPepewAddress(address);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid PEPEW address.";
    throw new PaymentUriError("invalid_address", message);
  }

  const values = new Map<string, string>();

  if (rawQuery) {
    for (const segment of rawQuery.split("&")) {
      if (!segment) {
        throw new PaymentUriError("invalid_query", "Payment URI query contains an empty parameter.");
      }

      const equalsIndex = segment.indexOf("=");
      if (equalsIndex < 0) {
        throw new PaymentUriError("invalid_query", "Every Payment URI query parameter must use name=value.");
      }

      const name = decodeQueryComponent(segment.slice(0, equalsIndex));
      const value = decodeQueryComponent(segment.slice(equalsIndex + 1));
      validateParameterName(name);

      if (values.has(name)) {
        throw new PaymentUriError("duplicate_parameter", `Duplicate Payment URI parameter: ${name}`);
      }
      values.set(name, value);
    }
  }

  const parsed: ParsedPaymentUri = { address };

  const amount = values.get("amount");
  if (amount !== undefined) {
    try {
      parsed.amountSats = parsePepewAmount(amount);
      parsed.amount = canonicalizePepewAmount(amount);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid PEPEW amount.";
      throw new PaymentUriError("invalid_amount", message);
    }
  }

  if (values.has("label")) {
    parsed.label = values.get("label") ?? "";
  }
  if (values.has("message")) {
    parsed.message = values.get("message") ?? "";
  }

  const extras: Record<string, string> = {};
  for (const [name, value] of values.entries()) {
    if (!KNOWN_PARAMETERS.has(name)) {
      extras[name] = value;
    }
  }
  if (Object.keys(extras).length > 0) {
    parsed.extras = extras;
  }

  return parsed;
}

export function formatPaymentUri(input: PaymentUriInput): string {
  let address: string;
  try {
    address = assertPepewAddress(input.address);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid PEPEW address.";
    throw new PaymentUriError("invalid_address", message);
  }

  const parameters: Array<[string, string]> = [];

  if (input.amount !== undefined) {
    try {
      parameters.push(["amount", canonicalizePepewAmount(input.amount)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid PEPEW amount.";
      throw new PaymentUriError("invalid_amount", message);
    }
  }

  const label = normalizeOptionalText(input.label, "label");
  const message = normalizeOptionalText(input.message, "message");
  if (label !== undefined) {
    parameters.push(["label", label]);
  }
  if (message !== undefined) {
    parameters.push(["message", message]);
  }

  if (input.extras !== undefined) {
    const extraEntries = Object.entries(input.extras).sort(([left], [right]) => left.localeCompare(right));
    for (const [name, value] of extraEntries) {
      validateParameterName(name);
      if (KNOWN_PARAMETERS.has(name)) {
        throw new PaymentUriError("duplicate_parameter", `Use the dedicated ${name} field instead of extras.`);
      }
      if (typeof value !== "string") {
        throw new PaymentUriError("invalid_parameter", `Extra Payment URI parameter ${name} must be a string.`);
      }
      parameters.push([name, value]);
    }
  }

  const query = parameters
    .map(([name, value]) => `${encodeQueryComponent(name)}=${encodeQueryComponent(value)}`)
    .join("&");

  return `${PEPEW_URI_SCHEME}:${address}${query ? `?${query}` : ""}`;
}
