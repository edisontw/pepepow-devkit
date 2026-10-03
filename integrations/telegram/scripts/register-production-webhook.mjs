import { access, chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { registerTemporaryWebhook } from "../src/e2e.mjs";

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
}

const apiKey = required("PEPEW_MERCHANT_API_KEY");
const url = required("PEPEW_PUBLIC_WEBHOOK_URL");
const output = required("PEPEW_WEBHOOK_ENV_FILE");
const apiOrigin = process.env.PEPEW_PAYMENT_API_ORIGIN ?? "https://pay.pepepow.net";

try {
  await access(output);
  throw new Error("webhook_env_file_exists");
} catch (error) {
  if (error?.message === "webhook_env_file_exists") throw error;
  if (error?.code !== "ENOENT") throw error;
}

const registration = await registerTemporaryWebhook({ apiOrigin, apiKey, url });
const payload = [
  `PEPEW_WEBHOOK_ENDPOINT_ID=${registration.endpointId}`,
  `PEPEW_WEBHOOK_SIGNING_SECRET=${registration.signingSecret}`,
  "",
].join("\n");

await mkdir(dirname(output), { recursive: true, mode: 0o700 });
const temporary = `${output}.tmp-${process.pid}`;
await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
await chmod(temporary, 0o600);
await rename(temporary, output);
await chmod(output, 0o600);
console.log(`telegram_production_webhook_registered file=${output}`);
