import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isNewerPaymentVersion } from "@pepepow/pepewpay-merchant";

export class StoreConflictError extends Error {
  constructor(code) {
    super(code);
    this.name = "StoreConflictError";
    this.code = code;
  }
}

function toOrder(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    idempotencyKey: row.idempotency_key,
    receiveAddress: row.receive_address,
    amount: row.amount,
    paymentId: row.payment_id,
    paymentVersion: row.payment_version,
    paymentStatus: row.payment_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MerchantStore {
  constructor(dbPath) {
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    this.db = new Database(dbPath);
    try {
      chmodSync(dbPath, 0o600);
    } catch {
      // Best effort on platforms without POSIX permission semantics.
    }
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS merchant_orders (
        order_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        receive_address TEXT NOT NULL,
        amount TEXT NOT NULL,
        payment_id TEXT UNIQUE,
        payment_version INTEGER,
        payment_status TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS processed_events (
        event_id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL,
        payment_version INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        processed_at INTEGER NOT NULL
      ) STRICT;
    `);
  }

  close() {
    this.db.close();
  }

  getOrder(orderId) {
    return toOrder(
      this.db
        .prepare("SELECT * FROM merchant_orders WHERE order_id = ?")
        .get(orderId),
    );
  }

  reserveOrder({ orderId, idempotencyKey, receiveAddress, amount, nowSeconds }) {
    const run = this.db.transaction(() => {
      const existing = this.getOrder(orderId);
      if (existing) {
        if (
          existing.idempotencyKey !== idempotencyKey ||
          existing.receiveAddress !== receiveAddress ||
          existing.amount !== amount
        ) {
          throw new StoreConflictError("order_identity_conflict");
        }
        return existing;
      }

      this.db.prepare(`
        INSERT INTO merchant_orders (
          order_id, idempotency_key, receive_address, amount,
          payment_id, payment_version, payment_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
      `).run(
        orderId,
        idempotencyKey,
        receiveAddress,
        amount,
        nowSeconds,
        nowSeconds,
      );
      return this.getOrder(orderId);
    });
    return run();
  }

  bindPayment(orderId, payment, nowSeconds) {
    const run = this.db.transaction(() => {
      const current = this.getOrder(orderId);
      if (!current) {
        throw new StoreConflictError("order_missing");
      }
      if (payment.merchant_reference !== orderId) {
        throw new StoreConflictError("merchant_reference_mismatch");
      }
      if (current.paymentId && current.paymentId !== payment.payment_id) {
        throw new StoreConflictError("payment_binding_conflict");
      }

      const applyState = isNewerPaymentVersion(
        current.paymentVersion,
        payment.version,
      );
      this.db.prepare(`
        UPDATE merchant_orders
        SET payment_id = ?,
            payment_version = ?,
            payment_status = ?,
            updated_at = ?
        WHERE order_id = ?
      `).run(
        current.paymentId ?? payment.payment_id,
        applyState ? payment.version : current.paymentVersion,
        applyState ? payment.status : current.paymentStatus,
        nowSeconds,
        orderId,
      );
      return this.getOrder(orderId);
    });
    return run();
  }

  applyWebhookEvent(event, nowSeconds) {
    const run = this.db.transaction(() => {
      const seen = this.db
        .prepare("SELECT 1 FROM processed_events WHERE event_id = ?")
        .get(event.event_id);
      if (seen) {
        return { outcome: "duplicate", order: null };
      }

      const merchantReference = event.data.merchant_reference ?? null;
      const row = merchantReference
        ? this.db
            .prepare("SELECT * FROM merchant_orders WHERE order_id = ?")
            .get(merchantReference)
        : this.db
            .prepare("SELECT * FROM merchant_orders WHERE payment_id = ?")
            .get(event.payment_id);
      const order = toOrder(row);
      if (!order) {
        return { outcome: "unknown_order", order: null };
      }
      if (order.paymentId && order.paymentId !== event.payment_id) {
        throw new StoreConflictError("payment_binding_conflict");
      }

      const applyState = isNewerPaymentVersion(
        order.paymentVersion,
        event.payment_version,
      );
      this.db.prepare(`
        UPDATE merchant_orders
        SET payment_id = ?,
            payment_version = ?,
            payment_status = ?,
            updated_at = ?
        WHERE order_id = ?
      `).run(
        order.paymentId ?? event.payment_id,
        applyState ? event.payment_version : order.paymentVersion,
        applyState ? event.data.status : order.paymentStatus,
        nowSeconds,
        order.orderId,
      );

      this.db.prepare(`
        INSERT INTO processed_events (
          event_id, payment_id, payment_version, event_type, processed_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        event.event_id,
        event.payment_id,
        event.payment_version,
        event.event_type,
        nowSeconds,
      );

      return {
        outcome: applyState ? "applied" : "stale",
        order: this.getOrder(order.orderId),
      };
    });
    return run();
  }

  hasProcessedEvent(eventId) {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM processed_events WHERE event_id = ?")
        .get(eventId),
    );
  }
}
