import assert from "node:assert/strict";
import test from "node:test";
import { parseTelegramPayCommand } from "../src/production.mjs";

test("production command parser accepts user-supplied address and exact PEPEW amount", () => {
  assert.deepEqual(
    parseTelegramPayCommand("/pay PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb 12.34000001"),
    {
      matched: true,
      address: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
      amount: "12.34000001",
    },
  );
  assert.deepEqual(
    parseTelegramPayCommand("/pay@pepew_bot PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb 1"),
    {
      matched: true,
      address: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
      amount: "1",
    },
  );
});

test("production command parser rejects missing address/amount and invalid amount", () => {
  assert.deepEqual(parseTelegramPayCommand("hello"), { matched: false });
  assert.equal(parseTelegramPayCommand("/pay").error, "usage");
  assert.equal(
    parseTelegramPayCommand("/pay PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb").error,
    "usage",
  );
  assert.equal(
    parseTelegramPayCommand("/pay PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb 0").error,
    "amount",
  );
  assert.equal(
    parseTelegramPayCommand("/pay PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb 1.000000001").error,
    "amount",
  );
  assert.equal(
    parseTelegramPayCommand("/pay PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb 1 extra").error,
    "usage",
  );
});
