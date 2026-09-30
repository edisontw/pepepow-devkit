import assert from "node:assert/strict";
import test from "node:test";
import {
  createDiscordChannelMessage,
  editDiscordChannelMessage,
  ensureDiscordGuildPaymentCommand,
} from "../src/bot-api.mjs";

const token = "test.discord.bot.token.value.123456789";
const channelId = "1423456789012345678";
const messageId = "1456789012345678901";
const applicationId = "1412345678901234567";
const guildId = "1467890123456789012";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Discord bot creates a channel message with Bot authorization", async () => {
  const calls = [];
  const message = {
    content: "test",
    allowed_mentions: { parse: [] },
  };
  const result = await createDiscordChannelMessage({
    token,
    channelId,
    message,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ id: messageId, channel_id: channelId });
    },
  });

  assert.equal(result.id, messageId);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, new RegExp(`/channels/${channelId}/messages$`));
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bot ${token}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), message);
});

test("Discord bot edits the same channel message", async () => {
  const calls = [];
  await editDiscordChannelMessage({
    token,
    channelId,
    messageId,
    message: {
      content: "PEPEW payment confirmed.",
      allowed_mentions: { parse: [] },
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ id: messageId, channel_id: channelId });
    },
  });

  assert.equal(calls[0].init.method, "PATCH");
  assert.match(
    calls[0].url,
    new RegExp(`/channels/${channelId}/messages/${messageId}$`),
  );
});

test("Discord guild command is created without replacing unrelated commands", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "GET") {
      return jsonResponse([{ id: "1478901234567890123", name: "other" }]);
    }
    return jsonResponse({
      id: "1489012345678901234",
      name: "pepew-pay",
    });
  };

  const result = await ensureDiscordGuildPaymentCommand({
    token,
    applicationId,
    guildId,
    fetchImpl,
  });

  assert.equal(result.name, "pepew-pay");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[1].init.method, "POST");
  const command = JSON.parse(calls[1].init.body);
  assert.equal(command.options[0].type, 3);
});

test("Discord guild command is patched in place when it already exists", async () => {
  const commandId = "1489012345678901234";
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "GET") {
      return jsonResponse([{ id: commandId, name: "pepew-pay" }]);
    }
    return jsonResponse({ id: commandId, name: "pepew-pay" });
  };

  await ensureDiscordGuildPaymentCommand({
    token,
    applicationId,
    guildId,
    fetchImpl,
  });

  assert.equal(calls[1].init.method, "PATCH");
  assert.match(calls[1].url, new RegExp(`/${commandId}$`));
});

test("Discord bot API errors do not include token text", async () => {
  await assert.rejects(
    () =>
      createDiscordChannelMessage({
        token,
        channelId,
        message: { content: "test" },
        fetchImpl: async () =>
          jsonResponse({ code: 50013, message: "Missing Permissions" }, 403),
      }),
    (error) => {
      assert.equal(String(error).includes(token), false);
      assert.equal(error.status, 403);
      return true;
    },
  );
});
