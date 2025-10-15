// src/services/orderService.ts
import { pool } from "../lib/db";

/**
 * Checkout result
 * - creates one order per vendor group
 * - payment snapshot stored in payments table per order
 */
export async function checkoutCartToOrders(
  cartId: number,
  shipping: {
    fullName: string;
    email: string;
    state: string;
    city: string;
    locality: string;
  },
  payment: { method: string; intentId?: string; status?: string },
  buyerId?: number
) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // load cart and items
    const [cRows]: any = await conn.query(
      "SELECT * FROM carts WHERE id = ? LIMIT 1",
      [cartId]
    );
    if (!cRows.length) {
      await conn.rollback();
      conn.release();
      return { success: false, message: "Cart not found" };
    }
    const cart = cRows[0];
    const [items]: any = await conn.query(
      "SELECT * FROM cart_items WHERE cart_id = ?",
      [cartId]
    );
    if (!items.length) {
      await conn.rollback();
      conn.release();
      return { success: false, message: "Cart empty" };
    }

    // group items by vendor_id (vendor_id may be null -> group under 0)
    const groups: Record<string, any[]> = {};
    for (const it of items) {
      const vid = (it.vendor_id ?? 0).toString();
      groups[vid] = groups[vid] || [];
      groups[vid].push(it);
    }

    const createdOrders: number[] = [];

    for (const vid of Object.keys(groups)) {
      const groupItems = groups[vid];
      const vendorIdNum = Number(vid) || null;

      // compute order total for this vendor
      let total = 0;
      for (const it of groupItems)
        total += Number(it.product_price) * Number(it.quantity);

      // create order
      const [orderRes]: any = await conn.query(
        `INSERT INTO orders (buyer_id, shipping_full_name, shipping_email, state, city, locality, total_amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          buyerId ?? null,
          shipping.fullName,
          shipping.email,
          shipping.state,
          shipping.city,
          shipping.locality,
          total,
          "processing",
        ]
      );
      const orderId = orderRes.insertId;
      createdOrders.push(orderId);

      // create order_items
      for (const it of groupItems) {
        await conn.query(
          `INSERT INTO order_items (order_id, product_id, vendor_id, product_name, product_price, quantity, line_total, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            orderId,
            it.product_id ?? null,
            it.vendor_id ?? null,
            it.product_name,
            it.product_price,
            it.quantity,
            Number(it.product_price) * Number(it.quantity),
          ]
        );

        // reduce product stock if product exists
        if (it.product_id) {
          await conn.query(
            "UPDATE products SET quantity = GREATEST(0, quantity - ?) WHERE id = ?",
            [it.quantity, it.product_id]
          );
        }
      }

      // create payment snapshot (one payment per order)
      await conn.query(
        `INSERT INTO payments (order_id, amount, provider, payment_intent_id, payment_method, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          orderId,
          total,
          payment.method,
          payment.intentId ?? null,
          payment.method,
          payment.status ?? "pending",
        ]
      );

      // update order status maybe to 'processing' or 'paid' depending on payment.status
      const newStatus =
        payment.status === "succeeded" || payment.status === "paid"
          ? "processing"
          : "processing";
      await conn.query("UPDATE orders SET status = ? WHERE id = ?", [
        newStatus,
        orderId,
      ]);
    }

    // clear cart
    await conn.query("DELETE FROM cart_items WHERE cart_id = ?", [cartId]);
    await conn.query("DELETE FROM carts WHERE id = ?", [cartId]);

    await conn.commit();
    conn.release();
    return { success: true, orders: createdOrders };
  } catch (err) {
    console.error("checkoutCartToOrders error", err);
    try {
      await conn.rollback();
    } catch (_) {}
    conn.release();
    throw err;
  }
}
