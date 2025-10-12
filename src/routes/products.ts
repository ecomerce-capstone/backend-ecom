// src/routes/products.ts
import express from "express";
import { query, body, param, validationResult } from "express-validator";
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

import { uploadBufferToCloudinary } from "../lib/cloudinary";
import { multerHandler } from "../middleware/uploadCloudinary";
// Tambahkan import di atas file:
import { deleteFromCloudinary } from "../lib/cloudinary";
import { ensureProductOwnership } from "../middleware/ownership";

const router = express.Router();

/**
 * GET /products
 */
router.get(
  "/",
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 200 }),
    query("categoryId").optional().isInt({ min: 1 }),
    query("vendorId").optional().isInt({ min: 1 }),
    query("q").optional().isString(),
    query("popular").optional().toBoolean().isBoolean(),
    query("recommend").optional().toBoolean().isBoolean(),
  ],
  async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Invalid query params", mapped);
    }

    const qParams = req.query as Record<string, string | undefined>;
    const page = parseInt((qParams.page as string) || "1", 10);
    const limit = parseInt((qParams.limit as string) || "20", 10);
    const offset = (page - 1) * limit;

    const q = (qParams.q as string) || null;
    const categoryId = qParams.categoryId ? Number(qParams.categoryId) : null;
    const vendorId = qParams.vendorId ? Number(qParams.vendorId) : null;
    const popular =
      qParams.popular === undefined
        ? null
        : qParams.popular === "true" || qParams.popular === "1"
        ? 1
        : 0;
    const recommend =
      qParams.recommend === undefined
        ? null
        : qParams.recommend === "true" || qParams.recommend === "1"
        ? 1
        : 0;

    try {
      const whereClauses: string[] = [];
      const params: any[] = [];

      if (q) {
        whereClauses.push(
          "(p.name LIKE ? OR p.short_description LIKE ? OR p.description LIKE ?)"
        );
        const like = `%${q}%`;
        params.push(like, like, like);
      }
      if (categoryId) {
        whereClauses.push("p.category_id = ?");
        params.push(categoryId);
      }
      if (vendorId) {
        whereClauses.push("p.vendor_id = ?");
        params.push(vendorId);
      }
      if (popular !== null) {
        whereClauses.push("p.popular = ?");
        params.push(popular);
      }
      if (recommend !== null) {
        whereClauses.push("p.recommend = ?");
        params.push(recommend);
      }

      const whereSQL = whereClauses.length
        ? `WHERE ${whereClauses.join(" AND ")}`
        : "";

      // total count
      const [countRows]: any = await pool.query(
        `SELECT COUNT(*) AS total FROM products p ${whereSQL}`,
        params
      );
      const total = countRows[0]?.total ?? 0;

      // select products with a main image (if exists)
      const sql = `
        SELECT p.*, pi.url AS image
        FROM products p
        LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.sort_order = 0
        ${whereSQL}
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const rowsParams = [...params, limit, offset];
      const [rows]: any = await pool.query(sql, rowsParams);

      if (total === 0) {
        return noData(res, "No products found");
      }

      const items = rows || [];
      const meta = { page, limit, total };
      return success(res, { items }, "Products fetched", 200, meta);
    } catch (err) {
      console.error("GET /products error", err);
      return errorResponse(res, 500, "Server error fetching products", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * GET /products/:id //ini done utk patch product
 */
router.get(
  "/:id",
  [param("id").isInt({ min: 1 })],
  async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Invalid product id", mapped);
    }
    const id = Number(req.params?.id ?? 0);
    try {
      const [rows]: any = await pool.query(
        `SELECT p.*, v.store_name AS vendor_store_name, v.id AS vendor_id
         FROM products p
         LEFT JOIN vendors v ON v.id = p.vendor_id
         WHERE p.id = ? LIMIT 1`,
        [id]
      );
      if (!rows.length) return noData(res, "Product not found");
      const product = rows[0];

      const [imgs]: any = await pool.query(
        "SELECT id, url, public_id, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order ASC",
        [id]
      );
      // fetch review list (top 20) and aggregate (count + avg)
      const [reviews]: any = await pool.query(
        "SELECT id, buyer_id, rating, review, created_at FROM product_reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 20",
        [id]
      );

      const [aggRows]: any = await pool.query(
        "SELECT COUNT(*) AS count, COALESCE(AVG(rating),0) AS average FROM product_reviews WHERE product_id = ?",
        [id]
      );
      const rating = aggRows[0]
        ? {
            count: Number(aggRows[0].count),
            average: Number(parseFloat(aggRows[0].average).toFixed(2)),
          }
        : { count: 0, average: 0 };

      const payload = { ...product, images: imgs, reviews, rating };
      return success(res, payload, "Product detail", 200);
    } catch (err) {
      console.error("GET /products/:id error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * POST /vendor/products
 */
router.post(
  "/vendor/products",
  requireAuth,
  requireRole("vendor"),
  [
    body("name").isString().notEmpty(),
    body("price").isFloat({ min: 0 }),
    body("quantity").isInt({ min: 0 }),
    body("category_id").optional().isInt({ min: 1 }),
    body("short_description").optional().isString(),
    body("description").optional().isString(),
    body("popular").optional().toBoolean(),
    body("recommend").optional().toBoolean(),
  ],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }
    try {
      const vendor = req.user;
      const {
        name,
        price,
        quantity,
        category_id,
        sku,
        short_description,
        description,
        popular,
        recommend,
      } = req.body;

      const popularNum = popular ? 1 : 0;
      const recommendNum = recommend ? 1 : 0;

      const [result]: any = await pool.query(
        `INSERT INTO products (vendor_id, category_id, name, sku, price, quantity, short_description, description, popular, recommend, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          vendor.id,
          category_id || null,
          name,
          sku || null,
          price,
          quantity,
          short_description || null,
          description || null,
          popularNum,
          recommendNum,
        ]
      );
      const productId = result.insertId;
      return success(res, { id: productId }, "Product created", 201);
    } catch (err) {
      console.error("POST /vendor/products error", err);
      return errorResponse(res, 500, "Server error creating product", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * PUT /vendor/products/:id
 */
router.put(
  "/vendor/products/:id",
  requireAuth,
  requireRole("vendor"),
  [
    param("id").isInt({ min: 1 }),
    body("name").optional().isString(),
    body("price").optional().isFloat({ min: 0 }),
    body("quantity").optional().isInt({ min: 0 }),
    body("category_id").optional().isInt({ min: 1 }),
    body("popular").optional().toBoolean(),
    body("recommend").optional().toBoolean(),
  ],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }
    const productId = Number(req.params.id);
    try {
      const vendor = req.user;
      const [pRows]: any = await pool.query(
        "SELECT id, vendor_id FROM products WHERE id = ? LIMIT 1",
        [productId]
      );
      if (!pRows.length) return noData(res, "Product not found");
      if (pRows[0].vendor_id !== vendor.id)
        return errorResponse(res, 403, "Forbidden: not your product", [
          { message: "Not product owner" },
        ]);

      const fields: string[] = [];
      const params: any[] = [];
      const updatable = [
        "name",
        "price",
        "quantity",
        "category_id",
        "short_description",
        "description",
        "sku",
        "popular",
        "recommend",
      ];
      for (const k of updatable) {
        if (req.body[k] !== undefined) {
          if (k === "popular" || k === "recommend") {
            const val = req.body[k] ? 1 : 0;
            fields.push(`${k} = ?`);
            params.push(val);
          } else {
            fields.push(`${k} = ?`);
            params.push(req.body[k]);
          }
        }
      }
      if (!fields.length)
        return errorResponse(res, 400, "No fields to update", [
          { message: "No update fields provided" },
        ]);

      params.push(productId);
      const sql = `UPDATE products SET ${fields.join(
        ", "
      )}, updated_at = NOW() WHERE id = ?`;
      await pool.query(sql, params);
      return success(res, null, "Product updated", 200);
    } catch (err) {
      console.error("PUT /vendor/products/:id error", err);
      return errorResponse(res, 500, "Server error updating product", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * DELETE /vendor/products/:id
 */
router.delete(
  "/vendor/products/:id",
  requireAuth,
  requireRole("vendor"),
  [param("id").isInt({ min: 1 })],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }
    const productId = Number(req.params.id);
    try {
      const vendor = req.user;
      const [pRows]: any = await pool.query(
        "SELECT id, vendor_id FROM products WHERE id = ? LIMIT 1",
        [productId]
      );
      if (!pRows.length) return noData(res, "Product not found");
      if (pRows[0].vendor_id !== vendor.id)
        return errorResponse(res, 403, "Forbidden: not your product", [
          { message: "Not product owner" },
        ]);

      await pool.query("DELETE FROM products WHERE id = ?", [productId]);
      return success(res, null, "Product deleted", 200);
    } catch (err) {
      console.error("DELETE /vendor/products/:id error", err);
      return errorResponse(res, 500, "Server error deleting product", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * POST /vendor/products/:id/images
 * Vendor: upload product image (multipart/form-data) field name: image
 */
router.post(
  "/vendor/products/:id/images",
  requireAuth,
  requireRole("vendor"),
  [param("id").isInt({ min: 1 })],
  // multer middleware to parse file into memory
  (req: express.Request, res: express.Response, next: express.NextFunction) =>
    multerHandler(req, res, next),
  async (req: AuthRequest, res: express.Response) => {
    // param validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }

    const productId = Number(req.params.id);
    try {
      const vendor = req.user;
      const [pRows]: any = await pool.query(
        "SELECT id, vendor_id FROM products WHERE id = ? LIMIT 1",
        [productId]
      );
      if (!pRows.length) return noData(res, "Product not found");
      if (pRows[0].vendor_id !== vendor.id)
        return errorResponse(res, 403, "Forbidden: not your product", [
          { message: "Not product owner" },
        ]);

      // multer stored buffer in req.file
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file || !file.buffer) {
        return errorResponse(res, 400, "No image uploaded", [
          { message: "No image file provided in 'image' field" },
        ]);
      }

      // upload to Cloudinary
      const folder = process.env.CLOUDINARY_UPLOAD_FOLDER || "emarket_products";
      const publicId = `product_${productId}_${Date.now()}`; // optional public_id
      let uploadResult;
      try {
        uploadResult = await uploadBufferToCloudinary(file.buffer, {
          folder,
          public_id: publicId,
        });
      } catch (uploadErr) {
        console.error("Cloudinary upload error", uploadErr);
        return errorResponse(res, 500, "Failed uploading image", [
          { message: "Image upload failed" },
        ]);
      }

      const imageUrl =
        (uploadResult &&
          (uploadResult.secure_url || (uploadResult as any).url)) ||
        null;
      const public_id =
        (uploadResult && (uploadResult.public_id || null)) || null;
      const sort_order =
        req.body && req.body.sort_order ? Number(req.body.sort_order) : 0;

      const [result]: any = await pool.query(
        "INSERT INTO product_images (product_id, url, public_id, sort_order, created_at) VALUES (?, ?, ?, ?, NOW())",
        [productId, imageUrl, public_id, sort_order]
      );

      return success(
        res,
        { id: result.insertId, url: imageUrl },
        "Image uploaded",
        201
      );
    } catch (err) {
      console.error("POST /vendor/products/:id/images (cloudinary) error", err);
      return errorResponse(res, 500, "Server error adding image", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * DELETE /vendor/products/:id/images/:imageId
 */
router.delete(
  "/vendor/products/:id/images/:imageId",
  requireAuth,
  requireRole("vendor"),
  [param("id").isInt({ min: 1 }), param("imageId").isInt({ min: 1 })],
  ensureProductOwnership,
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const mapped = mapValidationErrors(errors.array());
      return errorResponse(res, 400, "Validation failed", mapped);
    }
    const productId = Number(req.params.id);
    const imageId = Number(req.params.imageId);
    try {
      const vendor = req.user;
      const [pRows]: any = await pool.query(
        "SELECT id, vendor_id FROM products WHERE id = ? LIMIT 1",
        [productId]
      );
      if (!pRows.length) return noData(res, "Product not found");
      if (pRows[0].vendor_id !== vendor.id)
        return errorResponse(res, 403, "Forbidden: not your product", [
          { message: "Not product owner" },
        ]);

      //   const [imgRows]: any = await pool.query(
      //     "SELECT id, public_id FROM product_images WHERE id = ? AND product_id = ? LIMIT 1",
      //     [imageId, productId]
      //   );
      //   if (!imgRows.length) return noData(res, "Image not found");

      // Optional: delete image from Cloudinary using public_id (if stored)
      //   const publicId = imgRows[0].public_id;
      //   if (publicId) {
      //     try {
      //       // dynamic import to avoid circular in some setups
      //       const { v2: cloudinaryV2 } = await import("cloudinary");
      //       cloudinaryV2.config({
      //         cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "",
      //         api_key: process.env.CLOUDINARY_API_KEY || "",
      //         api_secret: process.env.CLOUDINARY_API_SECRET || "",
      //       });
      //       // ignore result for now
      //       await cloudinaryV2.uploader.destroy(publicId, {
      //         resource_type: "image",
      //       });
      //     } catch (e) {
      //       console.warn("Failed to delete image from Cloudinary:", e);
      //     }
      //   } ====end of olfd code====
      const [imgRows]: any = await pool.query(
        "SELECT id, public_id FROM product_images WHERE id = ? AND product_id = ? LIMIT 1",
        [imageId, productId]
      );
      if (!imgRows.length) return noData(res, "Image not found");

      const publicId = imgRows[0].public_id;

      // Hapus gambar di Cloudinary bila ada public_id
      if (publicId) {
        const deleted = await deleteFromCloudinary(publicId);
        if (!deleted) {
          console.warn(`Failed to delete Cloudinary image: ${publicId}`);
          // tidak return error supaya DB tetap bersih
        }
      }

      await pool.query("DELETE FROM product_images WHERE id = ?", [imageId]);
      return success(res, null, "Image deleted", 200);
    } catch (err) {
      console.error("DELETE image error", err);
      return errorResponse(res, 500, "Server error deleting image", [
        { message: "Server error" },
      ]);
    }
  }
);

export default router;
