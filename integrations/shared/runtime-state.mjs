import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SCHEMA_VERSION = 1;

function cleanPlatform(value) {
  const text = String(value ?? "").trim();
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(text)) {
    throw new TypeError("runtime_state_platform_invalid");
  }
  return text;
}

function emptyState(platform) {
  return {
    schema_version: SCHEMA_VERSION,
    platform,
    update_offset: null,
    payments: {},
  };
}

function validateState(value, platform) {
  if (!value || typeof value !== "object") {
    throw new Error("runtime_state_invalid");
  }
  if (value.schema_version !== SCHEMA_VERSION || value.platform !== platform) {
    throw new Error("runtime_state_schema_mismatch");
  }
  if (
    value.update_offset !== null &&
    (!Number.isSafeInteger(value.update_offset) || value.update_offset < 0)
  ) {
    throw new Error("runtime_state_update_offset_invalid");
  }
  if (!value.payments || typeof value.payments !== "object" || Array.isArray(value.payments)) {
    throw new Error("runtime_state_payments_invalid");
  }
  return value;
}

export class RuntimeStateStore {
  constructor({ path, platform, terminalRetentionSeconds = 30 * 24 * 60 * 60 }) {
    if (!path) throw new TypeError("runtime_state_path_required");
    this.path = path;
    this.platform = cleanPlatform(platform);
    this.terminalRetentionSeconds = terminalRetentionSeconds;
    if (!Number.isInteger(terminalRetentionSeconds) || terminalRetentionSeconds < 60) {
      throw new TypeError("runtime_state_retention_invalid");
    }
  }

  async load() {
    let raw;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return emptyState(this.platform);
      throw error;
    }
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("runtime_state_json_invalid");
    }
    return validateState(value, this.platform);
  }

  prune(state, nowSeconds = Math.floor(Date.now() / 1000)) {
    const cutoff = nowSeconds - this.terminalRetentionSeconds;
    for (const [paymentId, record] of Object.entries(state.payments)) {
      if (
        record &&
        typeof record === "object" &&
        Number.isSafeInteger(record.terminal_at) &&
        record.terminal_at < cutoff
      ) {
        delete state.payments[paymentId];
      }
    }
    return state;
  }

  async save(state) {
    validateState(state, this.platform);
    this.prune(state);
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const tempPath = `${this.path}.tmp-${process.pid}`;
    const payload = `${JSON.stringify(state, null, 2)}\n`;
    await writeFile(tempPath, payload, { encoding: "utf8", mode: 0o600 });
    await chmod(tempPath, 0o600);
    await rename(tempPath, this.path);
    await chmod(this.path, 0o600);
  }
}

export function pendingPaymentCount(state) {
  return Object.values(state.payments).filter(
    (record) => record && typeof record === "object" && !record.terminal_at,
  ).length;
}
