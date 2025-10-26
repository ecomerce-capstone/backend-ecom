// -------------------------
// File: src/routes/admin/reports.ts
// -------------------------

import express from "express";
import { pool, query } from "../../lib/db";

const router = express.Router();

// GET /admin/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/sales", async (req, res) => {
  try {
    const from = req.query.from || null;
    const to = req.query.to || null;
    let sql =
      "SELECT DATE(created_at) as date, SUM(total_amount) as total_sales FROM orders";
    const params: any[] = [];
    if (from && to) {
      sql += " WHERE created_at BETWEEN ? AND ?";
      params.push(from, to);
    }
    sql += " GROUP BY DATE(created_at) ORDER BY DATE(created_at) ASC";
    const rows = await query(sql, params);
    res.json({ data: rows });
  } catch (err: any) {
    console.error("admin/reports sales error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
