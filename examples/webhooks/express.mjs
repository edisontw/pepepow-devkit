import express from "express";
import { verifyWebhook, WebhookVerificationError } from "@pepepow/pepewpay-merchant";

const app = express();
const signingSecret = process.env.PEPEW_WEBHOOK_SIGNING_SECRET;
if (!signingSecret) throw new Error("PEPEW_WEBHOOK_SIGNING_SECRET is required");

// Register this raw-body route BEFORE any app-wide express.json() middleware.
app.post("/webhooks/pepew", express.raw({ type: "application/json", limit: "64kb" }), async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ ok: false });
    const event = verifyWebhook({ headers: req.headers, rawBody: req.body, signingSecret });

    // Replace with one durable merchant DB transaction:
    // event_id dedup + order lookup + payment_version ordering + business update.
    const outcome = await applyVerifiedEvent(event);
    if (outcome === "unknown_order") return res.status(409).json({ ok: false, error: "order_not_ready" });
    return res.sendStatus(204);
  } catch (error) {
    if (error instanceof WebhookVerificationError) return res.status(400).json({ ok: false });
    return res.status(500).json({ ok: false });
  }
});

// Other JSON routes may use parsed bodies after the webhook raw route.
app.use(express.json({ limit: "64kb" }));

async function applyVerifiedEvent(_event) {
  throw new Error("Replace applyVerifiedEvent with durable merchant storage logic before use");
}

export { app };
