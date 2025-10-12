// src/middleware/ownership.ts
import { Request, Response, NextFunction } from "express";
import { pool } from "../lib/db";
import { noData, error as errorResponse } from "../lib/response";

/**
 * ensureProductOwnership
 * Expects req.params.id (product id) and req.user populated by requireAuth.
 * Attaches product row to req.product if ok.
 */
export async function ensureProductOwnership(
  req: Request & { user?: any; product?: any },
  res: Response,
  next: NextFunction
) {
  const productId = Number(req.params.id);
  if (!productId)
    return errorResponse(res, 400, "Invalid product id", [
      { message: "Invalid product id" },
    ]);

  try {
    const [rows]: any = await pool.query(
      "SELECT id, vendor_id FROM products WHERE id = ? LIMIT 1",
      [productId]
    );
    if (!rows.length) return noData(res, "Product not found");
    const product = rows[0];
    if (!req.user)
      return errorResponse(res, 401, "Unauthorized", [
        { message: "Unauthorized" },
      ]);
    if (product.vendor_id !== req.user.id) {
      return errorResponse(res, 403, "Forbidden: not your product", [
        { message: "Not product owner" },
      ]);
    }
    req.product = product;
    return next();
  } catch (err) {
    console.error("ensureProductOwnership error", err);
    return errorResponse(res, 500, "Server error", [
      { message: "Server error" },
    ]);
  }
}
