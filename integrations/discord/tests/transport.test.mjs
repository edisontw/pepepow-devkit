import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign,
} from "node:crypto";
import test from "node:test";
import {
  DISCORD_PAYMENT_COMMAND,
  DiscordInteractionError,
  buildDiscordInteractionResponse,
  extractDiscordPaymentCommand,
  parseVerifiedDiscordInteraction,
  verifyDiscordInteractionSignature,
} from "../src/transport.mjs";

function signingFixture(payload) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const timestamp = "1790751600";
  const signature = sign(
    null,
    Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]),
    privateKey,
  ).toString("hex");
  const publicKeyHex = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("hex");

  return { publicKey: publicKeyHex, signature, timestamp, rawBody };
}

test("Discord interaction signature verifies exact raw request bytes", () => {
  const fixture = signingFixture({ type: 1 });
  assert.equal(verifyDiscordInteractionSignature(fixture), true);

  assert.throws(
    () =>
      verifyDiscordInteractionSignature({
        ...fixture,
        rawBody: Buffer.from('{"type": 2}', "utf8"),
      }),
    (error) =>
      error instanceof DiscordInteractionError &&
      error.code === "discord_signature_verification_failed",
  );
});

test("Discord interaction rejects malformed signature material", () => {
  const fixture = signingFixture({ type: 1 });
  assert.throws(
    () =>
      verifyDiscordInteractionSignature({
        ...fixture,
        signature: "00",
      }),
    /discord_signature_invalid/,
  );
});

test("verified Discord PING returns PONG", () => {
  const fixture = signingFixture({ type: 1 });
  const interaction = parseVerifiedDiscordInteraction(fixture);
  assert.deepEqual(buildDiscordInteractionResponse(interaction), { type: 1 });
});

test("pepew-pay slash command is deferred and preserves exact string amount", () => {
  const interaction = {
    id: "1434567890123456789",
    application_id: "1412345678901234567",
    channel_id: "1423456789012345678",
    type: 2,
    data: {
      name: "pepew-pay",
      options: [
        {
          type: 3,
          name: "address",
          value: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
        },
        {
          type: 3,
          name: "amount",
          value: "0.10000000",
        },
      ],
    },
  };

  assert.deepEqual(buildDiscordInteractionResponse(interaction), { type: 5 });
  assert.deepEqual(extractDiscordPaymentCommand(interaction), {
    applicationId: interaction.application_id,
    channelId: interaction.channel_id,
    interactionId: interaction.id,
    address: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
    amount: "0.10000000",
  });
});

test("Discord payment command never needs invoking user identity", () => {
  const interaction = {
    id: "1434567890123456789",
    application_id: "1412345678901234567",
    channel_id: "1423456789012345678",
    type: 2,
    member: {
      user: { id: "1499999999999999999" },
    },
    data: {
      name: "pepew-pay",
      options: [
        { type: 3, name: "address", value: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb" },
        { type: 3, name: "amount", value: "1.25" },
      ],
    },
  };

  const command = extractDiscordPaymentCommand(interaction);
  assert.equal(Object.hasOwn(command, "userId"), false);
});

test("Discord command requires address and keeps amount as a string option", () => {
  const address = DISCORD_PAYMENT_COMMAND.options.find((option) => option.name === "address");
  const amount = DISCORD_PAYMENT_COMMAND.options.find((option) => option.name === "amount");

  assert.equal(address?.type, 3);
  assert.equal(address?.required, true);
  assert.equal(amount?.type, 3);
  assert.equal(amount?.required, true);
});

test("Discord payment command rejects a missing address option", () => {
  assert.throws(
    () =>
      extractDiscordPaymentCommand({
        id: "1434567890123456789",
        application_id: "1412345678901234567",
        channel_id: "1423456789012345678",
        type: 2,
        data: {
          name: "pepew-pay",
          options: [{ type: 3, name: "amount", value: "1" }],
        },
      }),
    /discord_address_option_invalid/,
  );
});

test("unsupported Discord interactions fail closed", () => {
  assert.throws(
    () => buildDiscordInteractionResponse({ type: 3 }),
    /discord_interaction_unsupported/,
  );
});
