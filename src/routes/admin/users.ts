// -------------------------
// -------------------------
// File: src/routes/admin/users.ts
// -------------------------

import express from "express";
import { query, pool } from "../../lib/db";

const router = express.Router();

// GET /admin/users - list users with optional filters

router.get("/", async (req, res) => {
  try {
    const q = req.query.q || "";
    const sql = `SELECT id, name, email, status, created_at FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT 100`;
    const rows = await query(sql, [`%${q}%`, `%${q}%`]);
    res.json({ data: rows });
  } catch (err: any) {
    console.error("admin/users list error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/users/:id - detail
router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const rows: any = await query(
      "SELECT id, name, email, status, created_at FROM users WHERE id = ?",
      [id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });
    const [roles]: any = await query(
      "SELECT r.name FROM roles r JOIN user_has_roles ur ON ur.role_id=r.id WHERE ur.user_id=?",
      [id]
    );
    user.roles = roles.map((r: any) => r.name);
    res.json({ data: user });
  } catch (err: any) {
    console.error("admin/users detail error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /admin/users/:id/roles - replace roles
router.put("/:id/roles", async (req, res) => {
  try {
    const id = req.params.id;
    const roles: string[] = req.body.roles || [];
    if (!Array.isArray(roles))
      return res.status(400).json({ error: "roles must be array" });

    // transaction: delete existing, insert new
    const conn: any = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("DELETE FROM user_has_roles WHERE user_id = ?", [id]);
      for (const rname of roles) {
        // ensure role exists
        const [rRows] = await conn.query(
          "SELECT id FROM roles WHERE name = ? LIMIT 1",
          [rname]
        );
        let rid;
        if (rRows.length === 0) {
          const [resInsert]: any = await conn.query(
            "INSERT INTO roles (name) VALUES (?)",
            [rname]
          );
          rid = resInsert.insertId;
        } else {
          rid = rRows[0].id;
        }
        await conn.query(
          "INSERT INTO user_has_roles (user_id, role_id) VALUES (?, ?)",
          [id, rid]
        );
      }
      await conn.commit();
      res.json({ ok: true });
    } catch (err: any) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    console.error("admin/users roles error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /admin/users/:id/suspend
router.put("/:id/suspend", async (req, res) => {
  try {
    const id = req.params.id;
    const { reason } = req.body;
    await query("UPDATE users SET status = ? WHERE id = ?", ["suspended", id]);
    // optional: insert audit log table
    res.json({ ok: true });
  } catch (err: any) {
    console.error("admin/users suspend error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
