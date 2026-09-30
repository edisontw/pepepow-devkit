import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTelegramTransportSmokeMessage,
  normalizeTelegramApiEnvironment,
  runTelegramTransportSmoke,
  telegramApiCall,
  telegramTestApiCall,
} from "../src/transport.mjs";

const fakeToken = "123456789:abcdefghijklmnopqrstuvwxyzABCDE";

test("transport smoke message is clearly non-payment and uses HTTPS inline button", () => {
  const payload = buildTelegramTransportSmokeMessage({ chatId: "12345" });
  assert.equal(payload.chat_id, "12345");
  assert.match(payload.text, /TEST ONLY/);
  assert.match(payload.text, /no Payment Platform invoice was created/i);
  assert.equal(payload.reply_markup.inline_keyboard[0][0].text, "Pay with PEPEW");
  assert.equal(payload.reply_markup.inline_keyboard[0][0].url, "https://pay.pepepow.net/");
});

test("transport smoke message rejects non-HTTPS button URLs", () => {
  assert.throws(
    () => buildTelegramTransportSmokeMessage({
      chatId: "12345",
      checkoutUrl: "http://example.invalid/",
    }),
    /must use HTTPS/,
  );
});

test("Telegram API environment accepts only test or production", () => {
  assert.equal(normalizeTelegramApiEnvironment("test"), "test");
  assert.equal(normalizeTelegramApiEnvironment("PRODUCTION"), "production");
  assert.throws(() => normalizeTelegramApiEnvironment("staging"), /test or production/);
});

test("Telegram test environment uses the /test Bot API path", async () => {
  let observedUrl = "";
  await telegramTestApiCall({
    token: fakeToken,
    method: "getMe",
    fetchImpl: async (url) => {
      observedUrl = url;
      return { ok: true, async json() { return { ok: true, result: { id: 1, is_bot: true } }; } };
    },
  });
  assert.equal(observedUrl, `https://api.telegram.org/bot${fakeToken}/test/getMe`);
});

test("Telegram production environment omits the /test path", async () => {
  let observedUrl = "";
  await telegramApiCall({
    token: fakeToken,
    method: "getMe",
    apiEnvironment: "production",
    fetchImpl: async (url) => {
      observedUrl = url;
      return { ok: true, async json() { return { ok: true, result: { id: 1, is_bot: true } }; } };
    },
  });
  assert.equal(observedUrl, `https://api.telegram.org/bot${fakeToken}/getMe`);
  await assert.rejects(
    () => telegramApiCall({
      token: fakeToken,
      method: "deleteWebhook",
      apiEnvironment: "production",
    }),
    /unsupported Bot API method/,
  );
});

test("transport smoke ignores backlog, receives one fresh private update, and sends once", async () => {
  const calls = [];
  const statuses = [];
  const apiCall = async (input) => {
    calls.push(input);
    if (input.method === "getMe") return { id: 123456789, is_bot: true };
    if (input.method === "getUpdates" && input.body.offset === -1) {
      return [{ update_id: 40, message: { chat: { id: 7, type: "private" } } }];
    }
    if (input.method === "getUpdates") {
      return [{ update_id: 41, message: { chat: { id: 998877, type: "private" } } }];
    }
    if (input.method === "sendMessage") return { message_id: 55 };
    throw new Error("unexpected_method");
  };

  const result = await runTelegramTransportSmoke({
    token: fakeToken,
    apiEnvironment: "production",
    apiCall,
    onStatus(status) { statuses.push(status); },
  });

  assert.deepEqual(result, { received: true, sent: true });
  assert.deepEqual(calls.map((call) => call.method), [
    "getMe", "getUpdates", "getUpdates", "sendMessage",
  ]);
  assert.equal(calls[0].apiEnvironment, "production");
  assert.equal(calls[2].body.offset, 41);
  assert.equal(calls[3].body.chat_id, "998877");
  assert.deepEqual(statuses, [
    "telegram_bot_authenticated",
    "waiting_for_fresh_private_message",
    "telegram_smoke_message_sent",
  ]);
});

test("transport smoke never replies to a group update", async () => {
  let sent = false;
  const apiCall = async (input) => {
    if (input.method === "getMe") return { id: 1, is_bot: true };
    if (input.method === "getUpdates" && input.body.offset === -1) return [];
    if (input.method === "getUpdates") {
      return [{ update_id: 1, message: { chat: { id: -100123, type: "supergroup" } } }];
    }
    if (input.method === "sendMessage") { sent = true; return {}; }
    throw new Error("unexpected_method");
  };
  await assert.rejects(
    () => runTelegramTransportSmoke({
      token: fakeToken,
      apiEnvironment: "production",
      apiCall,
    }),
    /only replies to a private Telegram chat/,
  );
  assert.equal(sent, false);
});
