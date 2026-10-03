import { MerchantApiError } from "@pepepow/pepewpay-merchant";
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTelegramPayCommand,
  telegramMessageFromUpdate,
  telegramPaymentCreateConflictText,
} from "../src/production.mjs";

const botUsername = "PepewPayBot";
const address = "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb";

test("private command accepts plain /pay and this-bot mention", () => {
  assert.deepEqual(
    parseTelegramPayCommand(`/pay ${address} 12.34000001`, {
      chatType: "private",
      botUsername,
    }),
    { matched: true, address, amount: "12.34000001" },
  );
  assert.deepEqual(
    parseTelegramPayCommand(`/pay@${botUsername} ${address} 1`, {
      chatType: "private",
      botUsername,
    }),
    { matched: true, address, amount: "1" },
  );
});

test("group and supergroup accept plain /pay and ignore other-bot mentions", () => {
  for (const chatType of ["group", "supergroup"]) {
    assert.deepEqual(
      parseTelegramPayCommand(`/pay ${address} 0.1`, {
        chatType,
        botUsername,
      }),
      { matched: true, address, amount: "0.1" },
    );
    assert.deepEqual(
      parseTelegramPayCommand(`/pay@${botUsername} ${address} 0.1`, {
        chatType,
        botUsername,
      }),
      { matched: true, address, amount: "0.1" },
    );
    assert.deepEqual(
      parseTelegramPayCommand(`/pay@OtherBot ${address} 0.1`, {
        chatType,
        botUsername,
      }),
      { matched: false },
    );
  }
});

test("command parser rejects missing address/amount and invalid amount", () => {
  assert.deepEqual(parseTelegramPayCommand("hello", { botUsername }), { matched: false });
  assert.equal(parseTelegramPayCommand("/pay", { botUsername }).error, "usage");
  assert.equal(
    parseTelegramPayCommand(`/pay ${address}`, { botUsername }).error,
    "usage",
  );
  assert.equal(
    parseTelegramPayCommand(`/pay ${address} 0`, { botUsername }).error,
    "amount",
  );
  assert.equal(
    parseTelegramPayCommand(`/pay ${address} 1.000000001`, { botUsername }).error,
    "amount",
  );
  assert.equal(
    parseTelegramPayCommand(`/pay ${address} 1 extra`, { botUsername }).error,
    "usage",
  );
});

test("runtime accepts private, group, and supergroup messages only", () => {
  for (const chatType of ["private", "group", "supergroup"]) {
    const chatId = chatType === "private" ? 123 : -100123;
    assert.deepEqual(
      telegramMessageFromUpdate({
        message: {
          message_id: 42,
          text: "hello",
          chat: { id: chatId, type: chatType },
        },
      }),
      {
        chatId: String(chatId),
        messageId: "42",
        chatType,
        text: "hello",
      },
    );
  }

  assert.equal(
    telegramMessageFromUpdate({
      message: {
        message_id: 42,
        text: "hello",
        chat: { id: -100123, type: "channel" },
      },
    }),
    null,
  );
});


test("Telegram maps Payment Platform address-window conflicts to a user message", () => {
  const conflict = new MerchantApiError(409, "payment_address_in_use");
  assert.match(
    telegramPaymentCreateConflictText(conflict),
    /active time window/,
  );

  assert.equal(
    telegramPaymentCreateConflictText(
      new MerchantApiError(409, "payment_merchant_reference_conflict"),
    ),
    null,
  );
});
