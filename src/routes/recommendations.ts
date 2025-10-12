// src/routes/recommendations.ts
import express from "express";
import { query, param, validationResult } from "express-validator";
import { requireAuth, AuthRequest } from "../middleware/authMiddleware";
import {
  success,
  noData,
  error as errorResponse,
  mapValidationErrors,
} from "../lib/response";
import {
  getPopularProducts,
  getTopProductsByVendor,
  getUserCategoryDistribution,
  getRelatedProducts,
  getRatingsSummary,
  getRecommendationsForUser,
} from "../services/recommenderService";

const router = express.Router();

/**
 * GET /recommendations
 * Query: userId (optional), limit
 */
router.get(
  "/",
  [
    query("limit").optional().isInt({ min: 1, max: 50 }),
    query("userId").optional().isInt({ min: 1 }),
  ],
  async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return errorResponse(
        res,
        400,
        "Invalid query",
        mapValidationErrors(errors.array())
      );
    }
    const q = req.query as Record<string, string | undefined>;
    const limit = Number(q.limit || 10);
    const userIdQ = q.userId ? Number(q.userId) : null;

    try {
      if (userIdQ) {
        const recs = await getRecommendationsForUser(userIdQ, limit);
        if (!recs.length) return noData(res, "No recommendations");
        return success(res, { items: recs }, "Recommendations for user", 200);
      }
      const recs = await getPopularProducts(limit);
      if (!recs.length) return noData(res, "No recommendations");
      return success(res, { items: recs }, "Popular products", 200);
    } catch (err) {
      console.error("GET /recommendations error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * GET /recommendations/vendor/:vendorId/top-products
 */
router.get(
  "/vendor/:vendorId/top-products",
  [
    param("vendorId").isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return errorResponse(
        res,
        400,
        "Invalid params",
        mapValidationErrors(errors.array())
      );
    }
    const vendorId = Number(req.params.vendorId);
    const limit = Number((req.query as any).limit || 10);
    try {
      const rows = await getTopProductsByVendor(vendorId, limit);
      if (!rows.length) return noData(res, "No vendor products found");
      return success(res, { items: rows }, "Vendor top products", 200);
    } catch (err) {
      console.error("GET /recommendations/vendor error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * GET /recommendations/categories?userId=
 */
router.get(
  "/categories",
  [query("userId").isInt({ min: 1 })],
  async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return errorResponse(
        res,
        400,
        "Invalid query",
        mapValidationErrors(errors.array())
      );
    }
    const userId = Number((req.query as any).userId);
    try {
      const rows = await getUserCategoryDistribution(userId, 10);
      if (!rows.length) return noData(res, "No category data");
      return success(res, { items: rows }, "User categories", 200);
    } catch (err) {
      console.error("GET /recommendations/categories error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * GET /recommendations/products/:id
 */
router.get(
  "/products/:id",
  [
    param("id").isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return errorResponse(
        res,
        400,
        "Invalid params",
        mapValidationErrors(errors.array())
      );
    }
    const productId = Number(req.params.id);
    const limit = Number((req.query as any).limit || 10);
    try {
      const rows = await getRelatedProducts(productId, limit);
      if (!rows.length) return noData(res, "No related products found");
      return success(res, { items: rows }, "Related products", 200);
    } catch (err) {
      console.error("GET /recommendations/products/:id error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * GET /recommendations/ratings/summary
 */
router.get(
  "/ratings/summary",
  async (req: express.Request, res: express.Response) => {
    try {
      const data = await getRatingsSummary();
      return success(res, data, "Ratings summary", 200);
    } catch (err) {
      console.error("GET /recommendations/ratings error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

export default router;
