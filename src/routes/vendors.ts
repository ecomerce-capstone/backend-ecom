import express from "express";
import { param, query, body, validationResult } from "express-validator";
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

/*
GET /vendors
Query :page,limit,q (search by store_name OR name)

*/

router.get(
  "/",
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 200 }),
    query("q").optional().isString(),
  ],
  async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Invalid query", mapped);
    }
    const qParams = req.query as Record<string, string> | undefined;
    const page = parseInt((qParams?.page as string) || "1", 10);
    const limit = Math.min(
      parseInt((qParams?.limit as string) || "20", 10),
      200
    );
    const offset = (page - 1) * limit;
    const q = (qParams?.q as string) || null;

    try {
      const where: string[] = [];
      const params: any[] = [];
      if (q) {
        where.push("(v.store_name LIKE ? OR v.name LIKE ?)");
        const like = `%${q}%`;
        params.push(like, like);
      }

      const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [countRows]: any = await pool.query(
        `SELECT COUNT(*) as total FROM vendors v ${whereSQL}`,
        params
      );
      const total = countRows[0]?.total ?? 0;
      const sql = `SELECT v.id, v.name, v.email, v.phone, v.store_name, v.store_slug, v.store_description, v.store_image_url, v.created_at
        FROM vendors v
        ${whereSQL}
        ORDER BY v.created_at DESC
        LIMIT ? OFFSET ?
        `;
      const rowsParams = [...params, limit, offset];
      const [rows]: any = await pool.query(sql, rowsParams);
      if (!rows.length) return noData(res, "No vendors found");
      const meta = {
        page,
        limit,
        total,
        //total_pages: Math.ceil(total/limit),
      };
      return success(res, { vendors: rows }, "Vendors fetched", 200, meta);
    } catch (err) {
      console.error("GET /vendors error", err);
      return errorResponse(res, 500, "Server error fetching vendors", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * GET /vendors/:id
 * returns vendor profile and product count (and optionally sample products)
 */

router.get(
  "/:id",
  [param("id").isInt({ min: 1 })],
  async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Invalid vendor ID", mapped);
    }
    const id = parseInt(req.params.id, 10);
    try {
      const [rows]: any = await pool.query(
        `SELECT v.id, v.name, v.email, v.phone, v.store_name, v.store_slug, v.store_description, v.store_image_url, v.created_at
          FROM vendors v
          WHERE v.id = ? LIMIT 1`,
        [id]
      );
      if (!rows.length) return noData(res, "Vendor not found");
      const vendor = rows[0];
      // optional: product count for vendor
      const [prodCountRows]: any = await pool.query(
        "SELECT COUNT(*) AS total FROM products WHERE vendor_id = ?",
        [id]
      );
      const product_count = prodCountRows[0]?.total ?? 0;

      // optional: sample products (limit 6)
      const [sampleProducts]: any = await pool.query(
        `SELECT id, name, slug, price, quantity FROM products WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 6`,
        [id]
      );

      const payload = {
        ...vendor,
        product_count,
        sample_products: sampleProducts,
      };
      return success(res, payload, "Vendor profile", 200);
    } catch (err) {
      console.error("GET /vendors/:id error", err);
      return errorResponse(res, 500, "Server error fetching vendor", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * PUT /vendors/:id
 * vendor-only: update own profile/store info
 */

router.put(
  "/:id",
  requireAuth,
  requireRole("vendor"),
  [
    param("id").isInt({ min: 1 }),
    body("name").optional().isString(),
    body("phone").optional().isString(),
    body("store_name").optional().isString(),
    body("store_slug").optional().isString(),
    body("store_description").optional().isString(),
    body("store_image_url")
      .optional()
      .isString()
      .isURL()
      .optional({ nullable: true }),
  ],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Invalid request data", mapped);
    }
    const id = Number(req.params.id);
    //vendor can only update their own profile
    try {
      // ensure product owner: vendor can only update their own vendor record
      const vendorUser = req.user;
      if (!vendorUser)
        return errorResponse(res, 401, "Unauthorized", [
          { message: "Unauthorized" },
        ]);

      // fetch vendor row
      const [vRows]: any = await pool.query(
        "SELECT id FROM vendors WHERE id = ? LIMIT 1",
        [id]
      );
      if (!vRows.length) return noData(res, "Vendor not found");

      // ensure owner
      if (vRows[0].id !== vendorUser.id) {
        return errorResponse(res, 403, "Forbidden: not your vendor profile", [
          { message: "Not vendor owner" },
        ]);
      }

      const fields: string[] = [];
      const params: any[] = [];
      const updatable = [
        "name",
        "phone",
        "store_name",
        "store_slug",
        "store_description",
        "store_image_url",
      ];
      for (const k of updatable) {
        if (req.body[k] !== undefined) {
          fields.push(`${k} = ?`);
          params.push(req.body[k] === "" ? null : req.body[k]);
        }
      }
      if (!fields.length) {
        return errorResponse(res, 400, "No fields to update", [
          { message: "No update fields provided" },
        ]);
      }

      params.push(id);
      const sql = `UPDATE vendors SET ${fields.join(
        ", "
      )}, updated_at = NOW() WHERE id = ?`;
      await pool.query(sql, params);
      return success(res, null, "Vendor updated", 200);
    } catch (err) {
      console.error("PUT /vendors/:id error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);
export default router;
