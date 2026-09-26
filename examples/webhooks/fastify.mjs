import Fastify from "fastify";
import { verifyWebhook, WebhookVerificationError } from "@pepepow/pepewpay-merchant";

const fastify = Fastify({ bodyLimit: 64 * 1024 });
const signingSecret = process.env.PEPEW_WEBHOOK_SIGNING_SECRET;
if (!signingSecret) throw new Error("PEPEW_WEBHOOK_SIGNING_SECRET is required");

// This isolated example keeps application/json as Buffer so exact bytes survive.
// In a mixed Fastify app, encapsulate this parser/route in a scoped plugin rather than changing unrelated JSON routes.
fastify.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
  done(null, body);
});

fastify.post("/webhooks/pepew", async (request, reply) => {
  try {
    const rawBody = request.body;
    if (!Buffer.isBuffer(rawBody)) return reply.code(400).send({ ok: false });
    const event = verifyWebhook({ headers: request.headers, rawBody, signingSecret });

    // Replace with one durable merchant DB transaction:
    // event_id dedup + order lookup + payment_version ordering + business update.
    const outcome = await applyVerifiedEvent(event);
    if (outcome === "unknown_order") return reply.code(409).send({ ok: false, error: "order_not_ready" });
    return reply.code(204).send();
  } catch (error) {
    if (error instanceof WebhookVerificationError) return reply.code(400).send({ ok: false });
    return reply.code(500).send({ ok: false });
  }
});

async function applyVerifiedEvent(_event) {
  throw new Error("Replace applyVerifiedEvent with durable merchant storage logic before use");
}

export { fastify };
