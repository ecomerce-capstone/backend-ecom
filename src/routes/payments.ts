// src/routes/payments.ts
import express from "express";
import { body, param, validationResult } from "express-validator";
import { pool } from "../lib/db";
import {
  requireAuth,
  AuthRequest,
  requireRole,
} from "../middleware/authMiddleware";
import {
  success,
  noData,
  error as errorResponse,
  mapValidationErrors,
} from "../lib/response";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

/**
 * POST /orders/:id/pay
 * - Simulate creating a payment for an order (customer)
 * - Body: { provider: string, provider_payment_id?: string, amount?: number }
 *
 * Behavior:
 * - Check order exists and belongs to authenticated user
 * - Insert payment record (status = 'pending' by default)
 * - Optionally update order.status to 'paid' if provider_payment_id and amount validated
 * - For MVP we set order.status = 'paid' immediately when creating payment (simulate)
 */

// (inside src/routes/payments.ts) replace POST /orders/:id/pay handler with:

// Replace the existing POST /orders/:id/pay handler with this code:

router.post(
  "/orders/:id/pay",
  requireAuth,
  [
    param("id").isInt({ min: 1 }),
    body("provider").isString().notEmpty(),
    body("provider_payment_id").optional().isString(),
    body("amount").optional().isFloat({ min: 0 }),
  ],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }

    const orderId = Number(req.params.id);
    const user = req.user;
    if (!user)
      return errorResponse(res, 401, "Unauthorized", [
        { message: "Unauthorized" },
      ]);

    const { provider, provider_payment_id, amount } = req.body;

    let conn: any = null;
    try {
      conn = await (pool as any).getConnection();
      await conn.beginTransaction();

      // lock the requested order
      const [orderRows]: any = await conn.query(
        "SELECT id, user_id, total_amount, status, parent_order_id FROM orders WHERE id = ? LIMIT 1 FOR UPDATE",
        [orderId]
      );
      if (!orderRows.length) {
        await conn.rollback();
        return noData(res, "Order not found");
      }
      const order = orderRows[0];
      if (order.user_id !== user.id) {
        await conn.rollback();
        return errorResponse(res, 403, "Forbidden: not your order", [
          { message: "Not your order" },
        ]);
      }

      if (order.status === "paid") {
        await conn.rollback();
        return errorResponse(res, 400, "Order already paid", [
          { message: "Order already paid" },
        ]);
      }

      const payAmount = amount || order.total_amount;

      // create master payment record (for the orderId requested)
      const [payRes]: any = await conn.query(
        `INSERT INTO payments (order_id, provider, provider_payment_id, amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [orderId, provider, provider_payment_id || null, payAmount, "pending"]
      );
      const masterPaymentId = payRes.insertId;

      // if order is master (parent_order_id IS NULL) -> mark master + children paid and create linked child payments
      if (order.parent_order_id === null) {
        // fetch child orders (lock them)
        const [childRows]: any = await conn.query(
          "SELECT id, total_amount FROM orders WHERE parent_order_id = ? FOR UPDATE",
          [orderId]
        );

        // mark master payment as paid
        await conn.query("UPDATE payments SET status = ? WHERE id = ?", [
          "paid",
          masterPaymentId,
        ]);
        // mark master order as paid
        await conn.query(
          "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
          ["paid", orderId]
        );

        // create child payments (apportion) and mark child orders paid
        for (const c of childRows) {
          // create child payment linked to masterPaymentId
          await conn.query(
            `INSERT INTO payments (order_id, provider, provider_payment_id, amount, status, linked_payment_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [
              c.id,
              provider,
              provider_payment_id || null,
              c.total_amount,
              "paid",
              masterPaymentId,
            ]
          );
          // mark child order paid
          await conn.query(
            "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
            ["paid", c.id]
          );
        }

        await conn.commit();
        return success(
          res,
          {
            master_payment_id: masterPaymentId,
            master_order_id: orderId,
            children_count: childRows.length,
          },
          "Master payment recorded and child orders marked paid",
          200
        );
      } else {
        // it's a child order: mark payment and order as paid
        await conn.query("UPDATE payments SET status = ? WHERE id = ?", [
          "paid",
          masterPaymentId,
        ]);
        await conn.query(
          "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
          ["paid", orderId]
        );

        await conn.commit();
        return success(
          res,
          { payment_id: masterPaymentId, order_id: orderId },
          "Payment recorded and order marked as paid",
          201
        );
      }
    } catch (err) {
      console.error("POST /orders/:id/pay (with linked payments) error", err);
      try {
        if (conn) await conn.rollback();
      } catch (e) {}
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    } finally {
      try {
        if (conn) conn.release();
      } catch (e) {}
    }
  }
);

/**
 * POST /payments/webhook
 * - Provider webhook endpoint to update payment status
 * - No auth but optionally protected by a shared secret in header X-PAYMENT-WEBHOOK-SECRET
 * - Body: { provider: string, provider_payment_id: string, status: 'paid'|'failed'|'refunded', order_id?: number }
 */

//new

// paste/replace handler POST /payments/webhook in src/routes/payments.ts

router.post(
  "/payments/webhook",
  [
    body("provider").isString().notEmpty(),
    body("provider_payment_id").isString().notEmpty(),
    body("status").isString().notEmpty(),
    body("order_id").optional().isInt({ min: 1 }),
  ],
  async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }

    const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || null;
    const headerSecret = req.get("x-payment-webhook-secret");
    if (webhookSecret) {
      if (!headerSecret || headerSecret !== webhookSecret) {
        return errorResponse(res, 401, "Unauthorized webhook", [
          { message: "Invalid webhook secret" },
        ]);
      }
    }

    const { provider, provider_payment_id, status, order_id } = req.body;
    const normalized = String(status).toLowerCase();

    let conn: any = null;
    try {
      conn = await (pool as any).getConnection();
      await conn.beginTransaction();

      // 1) Try find existing payment by provider + provider_payment_id
      const [pRows]: any = await conn.query(
        "SELECT id, order_id, status FROM payments WHERE provider = ? AND provider_payment_id = ? LIMIT 1 FOR UPDATE",
        [provider, provider_payment_id]
      );

      if (pRows.length) {
        // existing payment found -> update its status
        const payment = pRows[0];
        await conn.query(
          "UPDATE payments SET status = ?, updated_at = NOW() WHERE id = ?",
          [normalized, payment.id]
        );

        // fetch order to decide master vs child
        const [orderRows]: any = await conn.query(
          "SELECT id, parent_order_id FROM orders WHERE id = ? LIMIT 1 FOR UPDATE",
          [payment.order_id]
        );
        const order = orderRows[0] || null;

        if (order) {
          if (order.parent_order_id === null) {
            // payment is for a master order -> ensure child payments exist and update children statuses
            const [childRows]: any = await conn.query(
              "SELECT id, total_amount FROM orders WHERE parent_order_id = ? FOR UPDATE",
              [order.id]
            );

            // check existing linked child payments to avoid duplicates
            const [linkedCheck]: any = await conn.query(
              "SELECT COUNT(*) AS cnt FROM payments WHERE linked_payment_id = ?",
              [payment.id]
            );
            const linkedCnt = linkedCheck[0]?.cnt ?? 0;

            // update master order status
            if (normalized === "paid") {
              await conn.query(
                "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
                ["paid", order.id]
              );
            } else if (normalized === "failed") {
              await conn.query(
                "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
                ["payment_failed", order.id]
              );
            } else if (normalized === "refunded") {
              await conn.query(
                "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
                ["refunded", order.id]
              );
            }

            // create linked child payments only if none exist yet
            if (linkedCnt === 0 && childRows.length) {
              for (const c of childRows) {
                await conn.query(
                  `INSERT INTO payments (order_id, provider, provider_payment_id, amount, status, linked_payment_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                  [
                    c.id,
                    provider,
                    provider_payment_id || null,
                    c.total_amount,
                    normalized === "paid" ? "paid" : normalized,
                    payment.id,
                  ]
                );
                // update child order status consistent with master
                if (normalized === "paid") {
                  await conn.query(
                    "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
                    ["paid", c.id]
                  );
                } else if (normalized === "failed") {
                  await conn.query(
                    "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
                    ["payment_failed", c.id]
                  );
                } else if (normalized === "refunded") {
                  await conn.query(
                    "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
                    ["refunded", c.id]
                  );
                }
              }
            }
          } else {
            // payment belongs to a child order -> update order status accordingly
            if (normalized === "paid") {
              await conn.query(
                "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
                ["paid", order.id]
              );
            } else if (normalized === "failed") {
              await conn.query(
                "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
                ["payment_failed", order.id]
              );
            } else if (normalized === "refunded") {
              await conn.query(
                "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
                ["refunded", order.id]
              );
            }
          }
        }

        await conn.commit();
        return success(
          res,
          { payment_id: pRows[0].id, status: normalized },
          "Payment status updated via webhook",
          200
        );
      }

      // 2) Payment not found — optionally create payment if order_id provided
      if (order_id) {
        // lock order row
        const [ordRows]: any = await conn.query(
          "SELECT id, parent_order_id, total_amount FROM orders WHERE id = ? LIMIT 1 FOR UPDATE",
          [order_id]
        );
        if (!ordRows.length) {
          await conn.rollback();
          return noData(res, "Order not found");
        }
        const ord = ordRows[0];

        // create payment record for provided order_id
        const [createRes]: any = await conn.query(
          `INSERT INTO payments (order_id, provider, provider_payment_id, amount, status, created_at)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [
            order_id,
            provider,
            provider_payment_id || null,
            ord.total_amount || 0,
            normalized,
          ]
        );
        const newPaymentId = createRes.insertId;

        // if order is master -> create linked child payments & update children statuses (if any)
        if (ord.parent_order_id === null) {
          // fetch child orders
          const [childRows]: any = await conn.query(
            "SELECT id, total_amount FROM orders WHERE parent_order_id = ? FOR UPDATE",
            [order_id]
          );

          // update master order status
          if (normalized === "paid") {
            await conn.query(
              "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
              ["paid", order_id]
            );
          } else if (normalized === "failed") {
            await conn.query(
              "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
              ["payment_failed", order_id]
            );
          } else if (normalized === "refunded") {
            await conn.query(
              "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
              ["refunded", order_id]
            );
          }

          // create child payments (linked)
          for (const c of childRows) {
            await conn.query(
              `INSERT INTO payments (order_id, provider, provider_payment_id, amount, status, linked_payment_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, NOW())`,
              [
                c.id,
                provider,
                provider_payment_id || null,
                c.total_amount,
                normalized === "paid" ? "paid" : normalized,
                newPaymentId,
              ]
            );
            // update child order status
            if (normalized === "paid") {
              await conn.query(
                "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
                ["paid", c.id]
              );
            } else if (normalized === "failed") {
              await conn.query(
                "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
                ["payment_failed", c.id]
              );
            } else if (normalized === "refunded") {
              await conn.query(
                "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
                ["refunded", c.id]
              );
            }
          }
        } else {
          // order is a child -> update order status based on webhook status
          if (normalized === "paid") {
            await conn.query(
              "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
              ["paid", order_id]
            );
          } else if (normalized === "failed") {
            await conn.query(
              "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
              ["payment_failed", order_id]
            );
          } else if (normalized === "refunded") {
            await conn.query(
              "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
              ["refunded", order_id]
            );
          }
        }

        await conn.commit();
        return success(
          res,
          { created: true, payment_id: newPaymentId, status: normalized },
          "Payment created via webhook and status applied",
          200
        );
      }

      // nothing to do
      await conn.rollback();
      return noData(res, "Payment record not found");
    } catch (err) {
      console.error("POST /payments/webhook error (enhanced)", err);
      try {
        if (conn) await conn.rollback();
      } catch (e) {}
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    } finally {
      try {
        if (conn) conn.release();
      } catch (e) {}
    }
  }
);

// GET /payments/master/:paymentId/allocations
// Admin-only: lihat master payment + allocations (child payments)

router.get(
  "/payments/master/:paymentId/allocations",
  requireAuth,
  requireRole("admin"),
  [param("paymentId").isInt({ min: 1 })],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Invalid payment id", mapped);
    }

    const paymentId = Number(req.params.paymentId);
    try {
      // fetch master payment
      const [masterRows]: any = await pool.query(
        `SELECT id, order_id, provider, provider_payment_id, amount, status, created_at, updated_at
         FROM payments WHERE id = ? LIMIT 1`,
        [paymentId]
      );
      if (!masterRows.length) return noData(res, "Payment not found");

      const master = masterRows[0];

      // fetch linked child payments
      const [childRows]: any = await pool.query(
        `SELECT id, order_id, provider, provider_payment_id, amount, status, linked_payment_id, created_at, updated_at
         FROM payments WHERE linked_payment_id = ? ORDER BY id ASC`,
        [paymentId]
      );

      // compute summary
      const childrenCount = childRows.length;
      const allocatedTotal = childRows.reduce(
        (s: number, c: any) => s + Number(c.amount || 0),
        0
      );
      const masterAmount = Number(master.amount || 0);
      const summary = {
        children_count: childrenCount,
        master_amount: masterAmount,
        allocated_total: Number(allocatedTotal.toFixed(2)),
        allocation_match:
          Number(masterAmount.toFixed(2)) === Number(allocatedTotal.toFixed(2)),
      };

      const payload = { master, allocations: childRows, summary };
      return success(res, payload, "Master payment allocations", 200);
    } catch (err) {
      console.error("GET /payments/master/:paymentId/allocations error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

export default router;
