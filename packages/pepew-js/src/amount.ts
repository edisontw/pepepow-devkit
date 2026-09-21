import { PEPEW_ATOMS_PER_COIN, PEPEW_DECIMALS } from "./constants.js";

export class PepewAmountError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PepewAmountError";
    this.code = code;
  }
}

const AMOUNT_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/;

export function parsePepewAmount(amount: string): bigint {
  if (typeof amount !== "string" || !amount) {
    throw new PepewAmountError("invalid_amount", "PEPEW amount must be a non-empty decimal string.");
  }

  const match = AMOUNT_PATTERN.exec(amount);
  if (!match) {
    throw new PepewAmountError(
      "invalid_amount",
      `PEPEW amount must be a plain positive decimal with at most ${PEPEW_DECIMALS} fractional digits.`,
    );
  }

  const whole = BigInt(match[1]);
  const fractionText = (match[2] ?? "").padEnd(PEPEW_DECIMALS, "0");
  const atoms = whole * PEPEW_ATOMS_PER_COIN + BigInt(fractionText || "0");

  if (atoms <= 0n) {
    throw new PepewAmountError("invalid_amount", "PEPEW payment amount must be greater than zero.");
  }

  return atoms;
}

export function formatPepewAmount(atoms: bigint): string {
  if (typeof atoms !== "bigint" || atoms < 0n) {
    throw new PepewAmountError("invalid_amount", "PEPEW atoms must be a non-negative bigint.");
  }

  const whole = atoms / PEPEW_ATOMS_PER_COIN;
  const fraction = (atoms % PEPEW_ATOMS_PER_COIN)
    .toString()
    .padStart(PEPEW_DECIMALS, "0")
    .replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function canonicalizePepewAmount(amount: string): string {
  return formatPepewAmount(parsePepewAmount(amount));
}
