import bs58check from "bs58check";

import { PEPEW_P2PKH_VERSION } from "./constants.js";

export class PepewAddressError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PepewAddressError";
    this.code = code;
  }
}

export function assertPepewAddress(address: string): string {
  if (typeof address !== "string") {
    throw new PepewAddressError("invalid_address", "PEPEW address must be a string.");
  }

  if (!address || address !== address.trim()) {
    throw new PepewAddressError("invalid_address", "PEPEW address is empty or contains surrounding whitespace.");
  }

  let payload: Uint8Array;
  try {
    payload = bs58check.decode(address);
  } catch {
    throw new PepewAddressError("invalid_address_checksum", "PEPEW address is not valid Base58Check.");
  }

  if (payload.length !== 21) {
    throw new PepewAddressError("invalid_address", "PEPEW P2PKH payload must contain a version byte and 20-byte hash.");
  }

  if (payload[0] !== PEPEW_P2PKH_VERSION) {
    throw new PepewAddressError("unsupported_address_version", "PEPEW address version is not supported.");
  }

  return address;
}

export function isValidPepewAddress(address: string): boolean {
  try {
    assertPepewAddress(address);
    return true;
  } catch {
    return false;
  }
}
