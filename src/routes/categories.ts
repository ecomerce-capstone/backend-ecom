// src/routes/categories.ts
import express from "express";
import { body, param, validationResult, query } from "express-validator";
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

/**
 * GET /categories
 * optional: ?q=search
 */
router.get(
  "/",
  [query("q").optional().isString()],
  async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Invalid query", mapped);
    }
    const q = (req.query.q as string) || null;
    try {
      if (q) {
        const like = `%${q}%`;
        const [rows]: any = await pool.query(
          "SELECT id, name, slug, parent_id, created_at FROM categories WHERE name LIKE ? ORDER BY name ASC",
          [like]
        );
        if (!rows.length) return noData(res, "No categories found");
        return success(res, rows, "Categories", 200);
      } else {
        const [rows]: any = await pool.query(
          "SELECT id, name, slug, parent_id, created_at FROM categories ORDER BY name ASC"
        );
        if (!rows.length) return noData(res, "No categories found");
        return success(res, rows, "Categories", 200);
      }
    } catch (err) {
      console.error("GET /categories error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * GET /categories/:id
 */
router.get(
  "/:id",
  [param("id").isInt({ min: 1 })],
  async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Invalid category id", mapped);
    }
    const id = Number(req.params.id);
    try {
      const [rows]: any = await pool.query(
        "SELECT id, name, slug, parent_id, created_at FROM categories WHERE id = ? LIMIT 1",
        [id]
      );
      if (!rows.length) return noData(res, "Category not found");
      return success(res, rows[0], "Category", 200);
    } catch (err) {
      console.error("GET /categories/:id error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * POST /categories (admin)
 */
router.post(
  "/",
  requireAuth,
  requireRole("admin"),
  [
    body("name").isString().notEmpty(),
    body("slug").optional().isString(),
    body("parent_id").optional().isInt({ min: 1 }),
  ],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }
    try {
      const { name, slug: rawSlug, parent_id } = req.body;
      const slug =
        rawSlug && String(rawSlug).trim().length
          ? String(rawSlug).trim()
          : String(name)
              .toLowerCase()
              .trim()
              .replace(/\s+/g, "-")
              .replace(/[^a-z0-9\-]/g, "");
      // if parent_id provided, ensure exists
      if (parent_id) {
        const [pRows]: any = await pool.query(
          "SELECT id FROM categories WHERE id = ? LIMIT 1",
          [parent_id]
        );
        if (!pRows.length)
          return errorResponse(res, 400, "Invalid parent_id", [
            { field: "parent_id", message: "Parent category not found" },
          ]);
      }
      const [result]: any = await pool.query(
        "INSERT INTO categories (name, slug, parent_id, created_at) VALUES (?, ?, ?, NOW())",
        [String(name).trim(), slug, parent_id || null]
      );
      return success(res, { id: result.insertId }, "Category created", 201);
    } catch (err: any) {
      console.error("POST /categories error", err);
      // handle duplicate slug
      if (err && err.code === "ER_DUP_ENTRY") {
        return errorResponse(res, 409, "Slug already exists", [
          { field: "slug", message: "Slug already in use" },
        ]);
      }
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * PUT /categories/:id (admin)
 */
router.put(
  "/:id",
  requireAuth,
  requireRole("admin"),
  [
    param("id").isInt({ min: 1 }),
    body("name").optional().isString(),
    body("slug").optional().isString(),
    body("parent_id").optional().isInt({ min: 1 }),
  ],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }
    const id = Number(req.params.id);
    try {
      // ensure exists
      const [existRows]: any = await pool.query(
        "SELECT id FROM categories WHERE id = ? LIMIT 1",
        [id]
      );
      if (!existRows.length) return noData(res, "Category not found");

      const fields: string[] = [];
      const params: any[] = [];
      const updatable = ["name", "slug", "parent_id"];
      for (const k of updatable) {
        if (req.body[k] !== undefined) {
          if (k === "parent_id") {
            params.push(req.body[k] || null);
            fields.push("parent_id = ?");
          } else {
            params.push(req.body[k]);
            fields.push(`${k} = ?`);
          }
        }
      }
      if (!fields.length)
        return errorResponse(res, 400, "No fields to update", [
          { message: "No update fields provided" },
        ]);

      params.push(id);
      const sql = `UPDATE categories SET ${fields.join(
        ", "
      )}, updated_at = NOW() WHERE id = ?`;
      await pool.query(sql, params);
      return success(res, null, "Category updated", 200);
    } catch (err: any) {
      console.error("PUT /categories/:id error", err);
      if (err && err.code === "ER_DUP_ENTRY") {
        return errorResponse(res, 409, "Slug already exists", [
          { field: "slug", message: "Slug already in use" },
        ]);
      }
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * DELETE /categories/:id (admin)
 * Prevent delete if products exist for safety
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
      const [existRows]: any = await pool.query(
        "SELECT id FROM categories WHERE id = ? LIMIT 1",
        [id]
      );
      if (!existRows.length) return noData(res, "Category not found");

      const [prodRows]: any = await pool.query(
        "SELECT COUNT(*) AS cnt FROM products WHERE category_id = ?",
        [id]
      );
      const cnt = prodRows[0]?.cnt ?? 0;
      if (cnt > 0)
        return errorResponse(res, 400, "Category has products", [
          {
            message:
              "Please reassign or remove products before deleting category",
          },
        ]);

      await pool.query("DELETE FROM categories WHERE id = ?", [id]);
      return success(res, null, "Category deleted", 200);
    } catch (err) {
      console.error("DELETE /categories/:id error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

export default router;
