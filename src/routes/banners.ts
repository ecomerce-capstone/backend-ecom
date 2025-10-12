// src/routes/banners.ts
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
import { deleteFromCloudinary } from "../lib/cloudinary";

const router = express.Router();

/**
 * GET /banners
 * Public: returns active banners sorted by sort_order ASC then created_at DESC
 * Query: limit, now (optional to override current time)
 */
router.get(
  "/",
  [
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("now").optional().isISO8601(), // optional override time (for testing)
  ],
  async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Invalid query", mapped);
    }

    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(Number(q.limit), 100) : 20;
      const now = q.now ? new Date(q.now) : new Date();

      // select banners that are active and within start/end if set
      const [rows]: any = await pool.query(
        `SELECT id, title, subtitle, image_url, public_id, target_url, sort_order, start_at, end_at, is_active
         FROM banners
         WHERE is_active = 1
           AND (start_at IS NULL OR start_at <= ?)
           AND (end_at IS NULL OR end_at >= ?)
         ORDER BY sort_order ASC, created_at DESC
         LIMIT ?`,
        [now, now, limit]
      );

      if (!rows.length) return noData(res, "No banners found");
      return success(res, { items: rows }, "Banners fetched", 200);
    } catch (err) {
      console.error("GET /banners error", err);
      return errorResponse(res, 500, "Server error fetching banners", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * POST /banners
 * Admin create banner
 * Body: { title, subtitle?, image_url?, public_id?, target_url?, is_active?, sort_order?, start_at?, end_at? }
 */
router.post(
  "/",
  requireAuth,
  requireRole("admin"),
  [
    body("title").isString().notEmpty(),
    body("subtitle").optional().isString(),
    body("image_url").optional().isString(),
    body("public_id").optional().isString(),
    body("target_url").optional().isString(),
    body("is_active").optional().isBoolean(),
    body("sort_order").optional().isInt(),
    body("start_at").optional().isISO8601(),
    body("end_at").optional().isISO8601(),
  ],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }

    const {
      title,
      subtitle,
      image_url,
      public_id,
      target_url,
      is_active,
      sort_order,
      start_at,
      end_at,
    } = req.body;

    try {
      const [result]: any = await pool.query(
        `INSERT INTO banners (title, subtitle, image_url, public_id, target_url, is_active, sort_order, start_at, end_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          String(title).trim(),
          subtitle || null,
          image_url || null,
          public_id || null,
          target_url || null,
          is_active ? 1 : 0,
          sort_order ?? 0,
          start_at || null,
          end_at || null,
        ]
      );
      return success(res, { id: result.insertId }, "Banner created", 201);
    } catch (err) {
      console.error("POST /banners error", err);
      return errorResponse(res, 500, "Server error creating banner", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * PUT /banners/:id
 * Admin update banner (partial)
 */
router.put(
  "/:id",
  requireAuth,
  requireRole("admin"),
  [
    param("id").isInt({ min: 1 }),
    body("title").optional().isString(),
    body("subtitle").optional().isString(),
    body("image_url").optional().isString(),
    body("public_id").optional().isString(),
    body("target_url").optional().isString(),
    body("is_active").optional().isBoolean(),
    body("sort_order").optional().isInt(),
    body("start_at").optional().isISO8601(),
    body("end_at").optional().isISO8601(),
  ],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }
    const id = Number(req.params.id);
    try {
      const [existRows]: any = await pool.query(
        "SELECT id FROM banners WHERE id = ? LIMIT 1",
        [id]
      );
      if (!existRows.length) return noData(res, "Banner not found");

      const fields: string[] = [];
      const params: any[] = [];
      const updatable = [
        "title",
        "subtitle",
        "image_url",
        "public_id",
        "target_url",
        "is_active",
        "sort_order",
        "start_at",
        "end_at",
      ];
      for (const k of updatable) {
        if (req.body[k] !== undefined) {
          // cast booleans and empty strings to null appropriately
          let val = req.body[k];
          if (k === "is_active") val = req.body[k] ? 1 : 0;
          params.push(val === "" ? null : val);
          fields.push(`${k} = ?`);
        }
      }
      if (!fields.length)
        return errorResponse(res, 400, "No fields to update", [
          { message: "No update fields provided" },
        ]);

      params.push(id);
      const sql = `UPDATE banners SET ${fields.join(
        ", "
      )}, updated_at = NOW() WHERE id = ?`;
      await pool.query(sql, params);
      return success(res, null, "Banner updated", 200);
    } catch (err) {
      console.error("PUT /banners/:id error", err);
      return errorResponse(res, 500, "Server error updating banner", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * DELETE /banners/:id
 * Admin delete — also delete image from Cloudinary if public_id exists
 */
router.delete(
  "/:id",
  requireAuth,
  requireRole("admin"),
  [param("id").isInt({ min: 1 })],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }
    const id = Number(req.params.id);
    try {
      const [rows]: any = await pool.query(
        "SELECT id, public_id FROM banners WHERE id = ? LIMIT 1",
        [id]
      );
      if (!rows.length) return noData(res, "Banner not found");
      const banner = rows[0];

      // attempt delete from Cloudinary if public_id
      if (banner.public_id) {
        try {
          await deleteFromCloudinary(banner.public_id);
        } catch (e) {
          // deleteFromCloudinary returns boolean and logs; proceed regardless
          console.warn("Cloudinary delete warning", e);
        }
      }

      await pool.query("DELETE FROM banners WHERE id = ?", [id]);
      return success(res, null, "Banner deleted", 200);
    } catch (err) {
      console.error("DELETE /banners/:id error", err);
      return errorResponse(res, 500, "Server error deleting banner", [
        { message: "Server error" },
      ]);
    }
  }
);

export default router;
