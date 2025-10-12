// src/routes/productReviews.ts
import express from "express";
import { param, body, query, validationResult } from "express-validator";
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
 * POST /products/:id/reviews
 * - Authenticated customers only
 * - Body: { rating: number 1-5, review?: string }
 * - One review per buyer per product allowed (returns 409 if already exist)
 */

router.post(
  "/products/:id/reviews",
  requireAuth,
  requireRole("customer"),
  [
    param("id").isInt({ min: 1 }),
    body("rating").isInt({ min: 1, max: 5 }),
    body("review").optional().isString(),
  ],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }

    const productId = Number(req.params.id);
    const user = req.user;
    if (!user)
      return errorResponse(res, 401, "Unauthorized", [
        { message: "Unauthorized" },
      ]);

    const { rating, review } = req.body;

    try {
      // ensure product exists
      const [pRows]: any = await pool.query(
        "SELECT id FROM products WHERE id = ? LIMIT 1",
        [productId]
      );
      if (!pRows.length) return noData(res, "Product not found");

      // check existing review by this buyer
      const [existing]: any = await pool.query(
        "SELECT id FROM product_reviews WHERE product_id = ? AND buyer_id = ? LIMIT 1",
        [productId, user.id]
      );
      if (existing.length) {
        return errorResponse(res, 409, "You already reviewed this product", [
          { message: "Review by this buyer already exists" },
        ]);
      }

      const [result]: any = await pool.query(
        "INSERT INTO product_reviews (product_id, buyer_id, rating, review, created_at) VALUES (?, ?, ?, ?, NOW())",
        [productId, user.id, rating, review || null]
      );

      // optional: compute updated aggregate (avg + count)
      const [aggRows]: any = await pool.query(
        "SELECT COUNT(*) AS count, COALESCE(AVG(rating),0) AS average FROM product_reviews WHERE product_id = ?",
        [productId]
      );
      const agg = aggRows[0] || { count: 0, average: 0 };

      return success(
        res,
        {
          id: result.insertId,
          aggregate: { count: Number(agg.count), average: Number(agg.average) },
        },
        "Review submitted",
        201
      );
    } catch (err) {
      console.error("POST /products/:id/reviews error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * GET /products/:id/reviews
 * Query: page, limit
 */
router.get(
  "/products/:id/reviews",
  [
    param("id").isInt({ min: 1 }),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 200 }),
  ],
  async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Invalid params", mapped);
    }

    const productId = Number(req.params.id);
    const q = req.query as Record<string, string | undefined>;
    const page = parseInt((q.page as string) || "1", 10);
    const limit = Math.min(parseInt((q.limit as string) || "20", 10), 200);
    const offset = (page - 1) * limit;

    try {
      // ensure product exists
      const [pRows]: any = await pool.query(
        "SELECT id FROM products WHERE id = ? LIMIT 1",
        [productId]
      );
      if (!pRows.length) return noData(res, "Product not found");

      // count
      const [countRows]: any = await pool.query(
        "SELECT COUNT(*) AS total FROM product_reviews WHERE product_id = ?",
        [productId]
      );
      const total = countRows[0]?.total ?? 0;
      if (total === 0) return noData(res, "No reviews found");

      // fetch reviews (include buyer basic info if necessary)
      const [rows]: any = await pool.query(
        `SELECT pr.id, pr.rating, pr.review, pr.created_at, u.id AS buyer_id, u.full_name AS buyer_name, u.avatar_url AS buyer_avatar
         FROM product_reviews pr
         LEFT JOIN users u ON u.id = pr.buyer_id
         WHERE pr.product_id = ?
         ORDER BY pr.created_at DESC
         LIMIT ? OFFSET ?`,
        [productId, limit, offset]
      );

      const meta = { page, limit, total };
      return success(res, { items: rows }, "Product reviews", 200, meta);
    } catch (err) {
      console.error("GET /products/:id/reviews error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

export default router;
