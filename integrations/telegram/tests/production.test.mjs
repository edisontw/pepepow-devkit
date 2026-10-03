import assert from "node:assert/strict";
import test from "node:test";
import { parseTelegramPayCommand } from "../src/production.mjs";

test("production command parser accepts exact PEPEW amount", () => {
  assert.deepEqual(parseTelegramPayCommand("/pay 12.34000001"), {
    matched: true,
    amount: "12.34000001",
  });
  assert.deepEqual(parseTelegramPayCommand("/pay@pepew_bot 1"), {
    matched: true,
    amount: "1",
  });
});

test("production command parser rejects missing and invalid amount", () => {
  assert.deepEqual(parseTelegramPayCommand("hello"), { matched: false });
  assert.equal(parseTelegramPayCommand("/pay").error, "usage");
  assert.equal(parseTelegramPayCommand("/pay 0").error, "amount");
  assert.equal(parseTelegramPayCommand("/pay 1.000000001").error, "amount");
});
