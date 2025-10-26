// -------------------------
// File: src/routes/admin/orders.ts
// -------------------------

import express from "express";
import { pool, query } from "../../lib/db";

const router = express.Router();

// GET /admin/orders - list all orders with filters
router.get("/", async (req, res) => {
  try {
    const status = req.query.status || null;
    let sql =
      "SELECT id, user_id, total_amount, status, created_at FROM orders";
    const params: any[] = [];
    if (status) {
      sql += " WHERE status = ?";
      params.push(status);
    }
    sql += " ORDER BY created_at DESC LIMIT 200";
    const rows = await query(sql, params);
    res.json({ data: rows });
  } catch (err: any) {
    console.error("admin/orders list error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /admin/orders/:id/status - change status
router.put("/:id/status", async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "status required" });
    await query("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("admin/orders status error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
