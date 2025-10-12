// src/routes/orders.ts
import express from "express";
import { body, param, query, validationResult } from "express-validator";
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

const router = express.Router();

/** helper to parse ints safely */
function toInt(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) && !Number.isNaN(n) ? Math.floor(n) : fallback;
}

/**
 * POST /orders  (create master + split child orders per vendor)
 *
 * Body:
 * {
 *   items: [{ product_id: number, quantity: number }],
 *   shipping_address?: string
 * }
 *
 * Returns:
 * {
 *   master_order: { id, user_id, total_amount, status, ... },
 *   child_orders: [{ order_id, vendor_id, total }, ...]
 * }
 */
router.post(
  "/",
  requireAuth,
  requireRole("customer"),
  [
    body("items").isArray({ min: 1 }),
    body("items.*.product_id").isInt({ min: 1 }),
    body("items.*.quantity").isInt({ min: 1 }),
    body("shipping_address").optional().isString(),
  ],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }

    const user = req.user;
    if (!user)
      return errorResponse(res, 401, "Unauthorized", [
        { message: "Unauthorized" },
      ]);

    const itemsInput = req.body.items as Array<{
      product_id: number;
      quantity: number;
    }>;
    const shippingAddress = req.body.shipping_address || null;

    // aggregate quantities by product_id
    const itemsMap = new Map<number, number>();
    for (const it of itemsInput) {
      const pid = toInt(it.product_id, 0);
      const qty = toInt(it.quantity, 0);
      if (!pid || qty <= 0)
        return errorResponse(res, 400, "Invalid items", [
          { message: "Invalid product_id or quantity" },
        ]);
      itemsMap.set(pid, (itemsMap.get(pid) || 0) + qty);
    }
    const items = Array.from(itemsMap.entries()).map(
      ([product_id, quantity]) => ({ product_id, quantity })
    );

    let conn: any = null;
    try {
      conn = await (pool as any).getConnection();
      await conn.beginTransaction();

      // Lock selected product rows
      const productIds = items.map((i) => i.product_id);
      const [prodRows]: any = await conn.query(
        `SELECT id, vendor_id, price, quantity, name FROM products WHERE id IN (?) FOR UPDATE`,
        [productIds]
      );

      const prodById = new Map<number, any>();
      for (const r of prodRows) prodById.set(r.id, r);

      // validate existence and stock
      for (const it of items) {
        const p = prodById.get(it.product_id);
        if (!p) {
          await conn.rollback();
          return noData(res, `Product not found: ${it.product_id}`);
        }
        if (p.quantity < it.quantity) {
          await conn.rollback();
          return errorResponse(
            res,
            400,
            `Insufficient stock for product ${p.name || p.id}`,
            [{ message: `Requested ${it.quantity}, available ${p.quantity}` }]
          );
        }
      }

      // group items by vendor_id
      const itemsByVendor = new Map<
        number,
        Array<{ product_id: number; quantity: number; unit_price: number }>
      >();
      for (const it of items) {
        const p = prodById.get(it.product_id);
        const vendorId = Number(p.vendor_id);
        if (!vendorId) {
          await conn.rollback();
          return errorResponse(res, 400, `Product ${p.id} has no vendor`, [
            { message: "Invalid vendor for product" },
          ]);
        }
        const arr = itemsByVendor.get(vendorId) || [];
        arr.push({
          product_id: it.product_id,
          quantity: it.quantity,
          unit_price: Number(p.price),
        });
        itemsByVendor.set(vendorId, arr);
      }

      // calculate grand total
      let grandTotal = 0;
      for (const [, vendorItems] of itemsByVendor.entries()) {
        for (const vi of vendorItems)
          grandTotal += Number(vi.unit_price) * Number(vi.quantity);
      }

      // create master order (vendor_id = NULL, parent_order_id = NULL)
      const [masterRes]: any = await conn.query(
        `INSERT INTO orders (user_id, vendor_id, parent_order_id, total_amount, status, shipping_address, created_at)
         VALUES (?, NULL, NULL, ?, ?, ?, NOW())`,
        [user.id, grandTotal, "pending", shippingAddress]
      );
      const masterId = masterRes.insertId;

      // create child orders per vendor
      const createdOrders: Array<{
        order_id: number;
        vendor_id: number;
        total: number;
      }> = [];

      for (const [vendorId, vendorItems] of itemsByVendor.entries()) {
        // calculate vendor total
        let vendorTotal = 0;
        for (const vi of vendorItems)
          vendorTotal += Number(vi.unit_price) * Number(vi.quantity);

        // insert child order with parent_order_id = masterId
        const [orderRes]: any = await conn.query(
          `INSERT INTO orders (user_id, vendor_id, parent_order_id, total_amount, status, shipping_address, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [user.id, vendorId, masterId, vendorTotal, "pending", shippingAddress]
        );
        const orderId = orderRes.insertId;

        // insert order_items and decrement stock
        for (const vi of vendorItems) {
          await conn.query(
            `INSERT INTO order_items (order_id, product_id, quantity, unit_price, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [orderId, vi.product_id, vi.quantity, vi.unit_price]
          );
          // decrement stock
          const p = prodById.get(vi.product_id);
          const newQty = Number(p.quantity) - Number(vi.quantity);
          await conn.query(`UPDATE products SET quantity = ? WHERE id = ?`, [
            newQty,
            vi.product_id,
          ]);
          p.quantity = newQty;
        }

        createdOrders.push({
          order_id: orderId,
          vendor_id: vendorId,
          total: vendorTotal,
        });
      }

      await conn.commit();

      // fetch master order to return
      const [masterRows]: any = await pool.query(
        "SELECT id, user_id, vendor_id, parent_order_id, total_amount, status, shipping_address, created_at FROM orders WHERE id = ? LIMIT 1",
        [masterId]
      );
      const masterOrder = masterRows[0] || null;

      return success(
        res,
        { master_order: masterOrder, child_orders: createdOrders },
        "Checkout created",
        201
      );
    } catch (err) {
      console.error("POST /orders (master+split) error", err);
      try {
        if (conn) await conn.rollback();
      } catch (e) {
        console.error("rollback error", e);
      }
      return errorResponse(res, 500, "Server error creating orders", [
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
 * GET /orders
 * - If customer: returns orders for the authenticated user
 * - Query: page, limit
 */
router.get(
  "/",
  requireAuth,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 200 }),
  ],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Invalid query params", mapped);
    }
    const user = req.user;
    if (!user)
      return errorResponse(res, 401, "Unauthorized", [
        { message: "Unauthorized" },
      ]);

    const q = req.query as Record<string, string | undefined>;
    const page = toInt(q.page, 1);
    const limit = Math.min(toInt(q.limit, 20), 200);
    const offset = (page - 1) * limit;

    try {
      const [countRows]: any = await pool.query(
        "SELECT COUNT(*) AS total FROM orders WHERE user_id = ? AND parent_order_id IS NULL",
        [user.id]
      );
      const total = countRows[0]?.total ?? 0;
      if (total === 0) return noData(res, "No orders found");

      const [rows]: any = await pool.query(
        "SELECT id, user_id, vendor_id, parent_order_id, total_amount, status, shipping_address, created_at, updated_at FROM orders WHERE user_id = ? AND parent_order_id IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [user.id, limit, offset]
      );

      const meta = { page, limit, total };
      return success(res, { items: rows }, "Orders fetched", 200, meta);
    } catch (err) {
      console.error("GET /orders error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * GET /orders/vendor
 * - Vendor: list child orders that belong to this vendor (only child orders)
 * - Query: page, limit
 */
router.get(
  "/vendor",
  requireAuth,
  requireRole("vendor"),
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 200 }),
  ],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Invalid query params", mapped);
    }
    const vendor = req.user;
    if (!vendor)
      return errorResponse(res, 401, "Unauthorized", [
        { message: "Unauthorized" },
      ]);

    const q = req.query as Record<string, string | undefined>;
    const page = toInt(q.page, 1);
    const limit = Math.min(toInt(q.limit, 20), 200);
    const offset = (page - 1) * limit;

    try {
      const [countRows]: any = await pool.query(
        `SELECT COUNT(*) AS total
         FROM orders o
         WHERE o.vendor_id = ? AND o.parent_order_id IS NOT NULL`,
        [vendor.id]
      );
      const total = countRows[0]?.total ?? 0;
      if (total === 0) return noData(res, "No vendor orders found");

      const [rows]: any = await pool.query(
        `SELECT o.id, o.user_id, o.vendor_id, o.parent_order_id, o.total_amount, o.status, o.shipping_address, o.created_at, o.updated_at
         FROM orders o
         WHERE o.vendor_id = ? AND o.parent_order_id IS NOT NULL
         ORDER BY o.created_at DESC
         LIMIT ? OFFSET ?`,
        [vendor.id, limit, offset]
      );

      const meta = { page, limit, total };
      return success(res, { items: rows }, "Vendor orders fetched", 200, meta);
    } catch (err) {
      console.error("GET /orders/vendor error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * GET /orders/:id
 * - If id is a master order (parent_order_id IS NULL) -> return master + child orders + their items
 * - If id is child order -> return that child + its items + parent metadata
 * - Authorization: customer owner or vendor related
 */
router.get(
  "/:id",
  requireAuth,
  [param("id").isInt({ min: 1 })],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Invalid order id", mapped);
    }
    const id = Number(req.params.id);
    const user = req.user;
    if (!user)
      return errorResponse(res, 401, "Unauthorized", [
        { message: "Unauthorized" },
      ]);

    try {
      const [orders]: any = await pool.query(
        "SELECT * FROM orders WHERE id = ? LIMIT 1",
        [id]
      );
      if (!orders.length) return noData(res, "Order not found");
      const order = orders[0];

      // If master order (parent_order_id IS NULL)
      if (order.parent_order_id === null) {
        // Authorization: customer owner of master or vendor who has at least one child order
        if (user.role === "customer") {
          if (order.user_id !== user.id)
            return errorResponse(res, 403, "Forbidden", [
              { message: "Not your order" },
            ]);
        } else if (user.role === "vendor") {
          // check vendor has any child under this master
          const [vendorCheck]: any = await pool.query(
            `SELECT COUNT(*) AS cnt FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id WHERE o.parent_order_id = ? AND p.vendor_id = ?`,
            [id, user.id]
          );
          const cnt = vendorCheck[0]?.cnt ?? 0;
          if (cnt === 0)
            return errorResponse(res, 403, "Forbidden", [
              { message: "Not your vendor order" },
            ]);
        } else {
          return errorResponse(res, 403, "Forbidden", [
            { message: "Forbidden" },
          ]);
        }

        // fetch child orders
        const [childRows]: any = await pool.query(
          "SELECT id, user_id, vendor_id, parent_order_id, total_amount, status, shipping_address, created_at, updated_at FROM orders WHERE parent_order_id = ? ORDER BY id ASC",
          [id]
        );
        const childIds = childRows.map((r: any) => r.id);
        // fetch items for all children
        const itemsMap: Record<string, any[]> = {};
        if (childIds.length) {
          const [items]: any = await pool.query(
            `SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.unit_price, p.name AS product_name, p.vendor_id
             FROM order_items oi
             LEFT JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id IN (?) ORDER BY oi.order_id ASC`,
            [childIds]
          );
          for (const it of items) {
            itemsMap[it.order_id] = itemsMap[it.order_id] || [];
            itemsMap[it.order_id].push(it);
          }
        }

        // attach items to child orders
        const childrenWithItems = childRows.map((c: any) => ({
          ...c,
          items: itemsMap[c.id] || [],
        }));
        const payload = { master: order, children: childrenWithItems };
        return success(res, payload, "Master order detail", 200);
      } else {
        // it's a child order
        // Authorization: customer owner or vendor owner of this child
        if (user.role === "customer") {
          if (order.user_id !== user.id)
            return errorResponse(res, 403, "Forbidden", [
              { message: "Not your order" },
            ]);
        } else if (user.role === "vendor") {
          const [vendorCheck]: any = await pool.query(
            `SELECT COUNT(*) AS cnt FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? AND p.vendor_id = ?`,
            [id, user.id]
          );
          const cnt = vendorCheck[0]?.cnt ?? 0;
          if (cnt === 0)
            return errorResponse(res, 403, "Forbidden", [
              { message: "Not your vendor order" },
            ]);
        } else {
          return errorResponse(res, 403, "Forbidden", [
            { message: "Forbidden" },
          ]);
        }

        // fetch items
        const [items]: any = await pool.query(
          `SELECT oi.id, oi.product_id, oi.quantity, oi.unit_price, p.name AS product_name, p.vendor_id
           FROM order_items oi
           LEFT JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = ?`,
          [id]
        );

        // fetch parent/master info
        const [parentRows]: any = await pool.query(
          "SELECT id, user_id, total_amount, status, shipping_address FROM orders WHERE id = ? LIMIT 1",
          [order.parent_order_id]
        );
        const parent = parentRows[0] || null;

        const payload = { order, items, parent };
        return success(res, payload, "Order detail", 200);
      }
    } catch (err) {
      console.error("GET /orders/:id error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

export default router;
