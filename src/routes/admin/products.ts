// -------------------------
// File: src/routes/admin/products.ts
// -------------------------

import express from "express";
import { pool, query } from "../../lib/db";
import { ownershipCheck } from "../../middleware/ownership";

const router = express.Router();

// GET /admin/products - list all products
router.get("/", async (req, res) => {
  try {
    const rows = await query(
      "SELECT id, name, price, vendor_id, status, created_at FROM products ORDER BY created_at DESC LIMIT 200"
    );
    res.json({ data: rows });
  } catch (err: any) {
    console.error("admin/products list error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /admin/products/:id - Admin can update any product
router.put("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updates = req.body;
    // simple allowed fields
    const allowed = ["name", "description", "price", "status"];
    const setParts: string[] = [];
    const values: any[] = [];
    for (const k of Object.keys(updates)) {
      if (allowed.includes(k)) {
        setParts.push(`\`${k}\` = ?`);
        values.push(updates[k]);
      }
    }
    if (setParts.length === 0)
      return res.status(400).json({ error: "No valid fields to update" });
    values.push(id);
    const sql = `UPDATE products SET ${setParts.join(", ")} WHERE id = ?`;
    await query(sql, values);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("admin/products update error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /admin/products/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await query("DELETE FROM products WHERE id = ?", [id]);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("admin/products delete error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
