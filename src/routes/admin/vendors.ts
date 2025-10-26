// -------------------------
// File: src/routes/admin/vendors.ts
// -------------------------

import express from "express";
import { pool, query } from "../../lib/db";

const router = express.Router();

// GET /admin/vendors - list vendors
router.get("/", async (req, res) => {
  try {
    const [rows]: any = await query(
      "SELECT id, name, email, status, created_at FROM vendors ORDER BY created_at DESC LIMIT 200"
    );
    res.json({ data: rows });
  } catch (err: any) {
    console.error("admin/vendors list error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /admin/vendors/:id/approve
router.put("/:id/approve", async (req, res) => {
  try {
    const id = req.params.id;
    await query("UPDATE vendors SET status = ? WHERE id = ?", ["approved", id]);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("admin/vendors approve error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /admin/vendors/:id/suspend
router.put("/:id/suspend", async (req, res) => {
  try {
    const id = req.params.id;
    await query("UPDATE vendors SET status = ? WHERE id = ?", [
      "suspended",
      id,
    ]);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("admin/vendors suspend error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
