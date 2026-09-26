import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function httpsOrigin(value, name) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a clean HTTPS origin`);
  }
  return url.origin;
}

function publicWebhookUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || url.hash) {
    throw new Error("PEPEW_PUBLIC_WEBHOOK_URL must be an HTTPS URL on port 443 without credentials or fragment");
  }
  return url.toString();
}

const apiOrigin = httpsOrigin(process.env.PEPEW_PAYMENT_API_ORIGIN ?? "https://pay.pepepow.net", "PEPEW_PAYMENT_API_ORIGIN");
const apiKey = required("PEPEW_MERCHANT_API_KEY");
const webhookUrl = publicWebhookUrl(required("PEPEW_PUBLIC_WEBHOOK_URL"));
const outputPath = resolve(process.env.PEPEW_WEBHOOK_REGISTRATION_FILE ?? "./data/webhook-registration.json");

try {
  await access(outputPath, constants.F_OK);
  throw new Error(`Refusing to overwrite existing registration file: ${outputPath}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const response = await fetch(`${apiOrigin}/api/v1/webhook-endpoints`, {
  method: "POST",
  headers: {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ url: webhookUrl }),
});

let payload;
try { payload = await response.json(); } catch { payload = null; }
if (!response.ok) {
  const code = payload?.error?.code ?? "webhook_registration_failed";
  throw new Error(`Webhook registration failed with HTTP ${response.status}: ${code}`);
}
if (!payload || typeof payload.endpoint_id !== "string" || typeof payload.signing_secret !== "string") {
  throw new Error("Webhook registration returned an invalid response");
}

await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
await writeFile(outputPath, JSON.stringify({ endpoint_id: payload.endpoint_id, signing_secret: payload.signing_secret }, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx",
});
try { await chmod(outputPath, 0o600); } catch {}

console.log(`Webhook endpoint registered. One-time credentials saved to ${outputPath}.`);
console.log("Move signing_secret into server-side secret storage, then delete the registration file.");
