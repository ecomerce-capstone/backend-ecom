// src/routes/users.ts
import express from "express";
import { requireAuth, AuthRequest } from "../middleware/authMiddleware";
import { pool } from "../lib/db";
import { success, noData, error as errorResponse } from "../lib/response";
import { multerHandler } from "../middleware/uploadCloudinary";
import { uploadBufferToCloudinary } from "../lib/cloudinary";

const router = express.Router();

// --- new route: POST /users/upload-avatar
router.post(
  "/upload-avatar",
  requireAuth,
  multerHandler,
  async (req: AuthRequest, res) => {
    try {
      const user = req.user;
      if (!user)
        return errorResponse(res, 401, "Unauthorized", [
          { message: "Unauthorized" },
        ]);

      // multerHandler places file buffer at req.file.buffer
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file || !file.buffer) {
        return errorResponse(res, 400, "No file uploaded", [
          { message: "No file uploaded" },
        ]);
      }

      // upload to cloudinary (folder avatars)
      const result = await uploadBufferToCloudinary(file.buffer, {
        folder: process.env.CLOUDINARY_UPLOAD_FOLDER
          ? `${process.env.CLOUDINARY_UPLOAD_FOLDER}/avatars`
          : "avatars",
        public_id: `user_${user.id}_avatar_${Date.now()}`,
      });

      // optional: delete old avatar if exists (we assume avatar_url stores secure_url or public_id)
      // If you store public_id in DB, adapt below; here we try to extract public_id from store (best-effort)
      const [rows]: any = await pool.query(
        "SELECT avatar_url FROM users WHERE id = ? LIMIT 1",
        [user.id]
      );
      if (rows && rows.length && rows[0].avatar_url) {
        // if you saved public_id separately, call deleteFromCloudinary(public_id)
        // skip removal if you only store secure_url (can't reliably delete without public_id)
      }

      // update DB: set avatar_url (use result.secure_url)
      await pool.query(
        "UPDATE users SET avatar_url = ?, updated_at = NOW() WHERE id = ?",
        [result.secure_url || result.url, user.id]
      );

      return success(
        res,
        { url: result.secure_url || result.url, public_id: result.public_id },
        "Avatar uploaded",
        201
      );
    } catch (err) {
      console.error("POST /users/upload-avatar error", err);
      return errorResponse(res, 500, "Upload failed", [
        { message: "Upload failed" },
      ]);
    }
  }
);

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
