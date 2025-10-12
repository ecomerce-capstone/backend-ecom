// src/routes/users.ts
import express from "express";
import { requireAuth, AuthRequest } from "../middleware/authMiddleware";
import { pool } from "../lib/db";
import { success, noData, error as errorResponse } from "../lib/response";

const router = express.Router();
/**
 * GET /users/me
 * - returns customer or vendor profile based on auth token role
 */
router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const u = req.user;
    if (!u)
      return errorResponse(res, 401, "Unauthorized", [
        { message: "Unauthorized" },
      ]);

    if (u.role === "customer") {
      const [rows]: any = await pool.query(
        "SELECT id,full_name,email,phone,avatar_url,created_at FROM users WHERE id = ?",
        [u.id]
      );
      if (!rows.length) return noData(res, "User not found");
      return success(res, rows[0], " OK", 200);
    } else if (u.role === "vendor") {
      const [rows]: any = await pool.query(
        "SELECT id,email,name,phone,store_name, \
                store_slug,store_description,store_image_url,created_at FROM vendors WHERE id = ?",
        [u.id]
      );
      if (!rows.length) return noData(res, "Vendor not found");

      return success(res, rows[0], "OK", 200);
    }
    return noData(res, "No profile data");
  } catch (err) {
    console.error("GET /users/me error", err);
    return errorResponse(res, 500, "Server error", [
      { message: "Server error" },
    ]);
  }
});
export default router;
