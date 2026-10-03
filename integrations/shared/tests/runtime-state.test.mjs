import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RuntimeStateStore, pendingPaymentCount } from "../runtime-state.mjs";

test("runtime state persists pending payment and offset", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pepew-runtime-state-"));
  const path = join(dir, "state.json");
  const store = new RuntimeStateStore({ path, platform: "telegram" });
  const state = await store.load();
  state.update_offset = 42;
  state.payments.pay_test1234 = {
    current_version: 1,
    terminal_at: null,
  };
  await store.save(state);
  const loaded = await store.load();
  assert.equal(loaded.update_offset, 42);
  assert.equal(pendingPaymentCount(loaded), 1);
  assert.match(await readFile(path, "utf8"), /pay_test1234/);
});

test("runtime state prunes old terminal records but keeps pending", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pepew-runtime-state-"));
  const store = new RuntimeStateStore({
    path: join(dir, "state.json"),
    platform: "discord",
    terminalRetentionSeconds: 60,
  });
  const state = await store.load();
  state.payments.old = { terminal_at: 100 };
  state.payments.pending = { terminal_at: null };
  store.prune(state, 200);
  assert.equal(state.payments.old, undefined);
  assert.ok(state.payments.pending);
});
