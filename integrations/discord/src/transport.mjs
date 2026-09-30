import {
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";

const PUBLIC_KEY_RE = /^[0-9a-fA-F]{64}$/;
const SIGNATURE_RE = /^[0-9a-fA-F]{128}$/;
const TIMESTAMP_RE = /^[0-9]{1,20}$/;
const DISCORD_ID_RE = /^[1-9][0-9]{0,19}$/;
const ED25519_SPKI_PREFIX = Buffer.from(
  "302a300506032b6570032100",
  "hex",
);

export class DiscordInteractionError extends Error {
  constructor(code) {
    super(code);
    this.name = "DiscordInteractionError";
    this.code = code;
  }
}

function rawBytes(value) {
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  throw new DiscordInteractionError("discord_raw_body_invalid");
}

function normalizeHeader(value, pattern, code) {
  const text = String(value ?? "").trim();
  if (!pattern.test(text)) {
    throw new DiscordInteractionError(code);
  }
  return text;
}

function normalizeSnowflake(value, code) {
  const text = String(value ?? "").trim();
  if (!DISCORD_ID_RE.test(text)) {
    throw new DiscordInteractionError(code);
  }
  return text;
}

function ed25519PublicKey(publicKeyHex) {
  const raw = Buffer.from(publicKeyHex, "hex");
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

export function verifyDiscordInteractionSignature({
  publicKey,
  signature,
  timestamp,
  rawBody,
}) {
  const publicKeyHex = normalizeHeader(
    publicKey,
    PUBLIC_KEY_RE,
    "discord_public_key_invalid",
  );
  const signatureHex = normalizeHeader(
    signature,
    SIGNATURE_RE,
    "discord_signature_invalid",
  );
  const timestampText = normalizeHeader(
    timestamp,
    TIMESTAMP_RE,
    "discord_timestamp_invalid",
  );
  const body = rawBytes(rawBody);

  const signed = Buffer.concat([
    Buffer.from(timestampText, "utf8"),
    body,
  ]);

  const verified = verifySignature(
    null,
    signed,
    ed25519PublicKey(publicKeyHex),
    Buffer.from(signatureHex, "hex"),
  );

  if (!verified) {
    throw new DiscordInteractionError("discord_signature_verification_failed");
  }
  return true;
}

export function parseVerifiedDiscordInteraction({
  publicKey,
  signature,
  timestamp,
  rawBody,
}) {
  verifyDiscordInteractionSignature({
    publicKey,
    signature,
    timestamp,
    rawBody,
  });

  let interaction;
  try {
    interaction = JSON.parse(Buffer.from(rawBody).toString("utf8"));
  } catch {
    throw new DiscordInteractionError("discord_interaction_json_invalid");
  }

  if (
    !interaction ||
    typeof interaction !== "object" ||
    !Number.isInteger(interaction.type)
  ) {
    throw new DiscordInteractionError("discord_interaction_invalid");
  }
  return interaction;
}

export function buildDiscordInteractionResponse(interaction) {
  if (!interaction || typeof interaction !== "object") {
    throw new DiscordInteractionError("discord_interaction_invalid");
  }

  if (interaction.type === 1) {
    return { type: 1 };
  }

  if (
    interaction.type === 2 &&
    interaction.data?.name === "pepew-pay"
  ) {
    return { type: 5 };
  }

  throw new DiscordInteractionError("discord_interaction_unsupported");
}

export function extractDiscordPaymentCommand(interaction) {
  if (
    !interaction ||
    typeof interaction !== "object" ||
    interaction.type !== 2 ||
    interaction.data?.name !== "pepew-pay"
  ) {
    throw new DiscordInteractionError("discord_payment_command_invalid");
  }

  const applicationId = normalizeSnowflake(
    interaction.application_id,
    "discord_application_id_invalid",
  );
  const channelId = normalizeSnowflake(
    interaction.channel_id,
    "discord_channel_id_invalid",
  );
  const interactionId = normalizeSnowflake(
    interaction.id,
    "discord_interaction_id_invalid",
  );

  const options = Array.isArray(interaction.data.options)
    ? interaction.data.options
    : [];
  const amountOption = options.find(
    (option) =>
      option &&
      typeof option === "object" &&
      option.name === "amount" &&
      option.type === 3,
  );

  if (!amountOption || typeof amountOption.value !== "string") {
    throw new DiscordInteractionError("discord_amount_option_invalid");
  }

  return {
    applicationId,
    channelId,
    interactionId,
    amount: amountOption.value,
  };
}

export const DISCORD_PAYMENT_COMMAND = Object.freeze({
  name: "pepew-pay",
  description: "Create a PEPEW payment request",
  type: 1,
  options: [
    {
      type: 3,
      name: "amount",
      description: "PEPEW amount, up to 8 decimal places",
      required: true,
    },
  ],
});
