// src/services/recommenderService.ts
import { pool } from "../lib/db";

/**
 * Simple SQL-based recommender helpers for MVP.
 * Uses existing tables: products, order_items, orders, product_reviews, categories, product_images
 *
 * Perubahan utama:
 * - Hindari ONLY_FULL_GROUP_BY errors dengan mengagregasi di derived tables.
 * - Hindari double-counting (multiplicative join effects) dengan menghitung agregat per-table.
 * - Ambil 1 gambar deterministik memakai correlated subquery (sort_order = 0).
 * - Perbaikan bug pada pembuatan boughtIds.
 */

/** Get global popular products (by sold units) */
export async function getPopularProducts(limit = 10) {
  const [rows]: any = await pool.query(
    `SELECT
       p.id, p.name, p.price, p.vendor_id, p.category_id,
       COALESCE(s.sold_count, 0) AS sold_count,
       (
         SELECT pi2.url
         FROM product_images pi2
         WHERE pi2.product_id = p.id
           AND pi2.sort_order = 0
         LIMIT 1
       ) AS image
     FROM products p
     LEFT JOIN (
       SELECT product_id, SUM(quantity) AS sold_count
       FROM order_items
       GROUP BY product_id
     ) s ON s.product_id = p.id
     ORDER BY sold_count DESC, p.created_at DESC
     LIMIT ?`,
    [limit]
  );
  return rows || [];
}

/** Top products for a vendor (by sold quantity) */
export async function getTopProductsByVendor(vendorId: number, limit = 10) {
  const [rows]: any = await pool.query(
    `SELECT
       p.id, p.name, p.price, p.vendor_id,
       COALESCE(s.sold_qty, 0) AS sold_qty,
       COALESCE(r.avg_rating, 0) AS avg_rating,
       (
         SELECT pi2.url
         FROM product_images pi2
         WHERE pi2.product_id = p.id
           AND pi2.sort_order = 0
         LIMIT 1
       ) AS image
     FROM products p
     LEFT JOIN (
       SELECT product_id, SUM(quantity) AS sold_qty
       FROM order_items
       GROUP BY product_id
     ) s ON s.product_id = p.id
     LEFT JOIN (
       SELECT product_id, AVG(rating) AS avg_rating
       FROM product_reviews
       GROUP BY product_id
     ) r ON r.product_id = p.id
     WHERE p.vendor_id = ?
     ORDER BY sold_qty DESC
     LIMIT ?`,
    [vendorId, limit]
  );
  return rows || [];
}

/** Category distribution for a user (which categories they bought from) */
export async function getUserCategoryDistribution(userId: number, limit = 10) {
  const [rows]: any = await pool.query(
    `SELECT c.id AS category_id, c.name AS category_name,
            COALESCE(SUM(oi.quantity), 0) AS purchases
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE o.user_id = ?
     GROUP BY c.id
     ORDER BY purchases DESC
     LIMIT ?`,
    [userId, limit]
  );
  return rows || [];
}

/** Related products for a given product id
 * Strategy:
 *  1) same category popular products (exclude self)
 *  2) co-purchase (products bought in same orders) — ranked by co-occurrence
 * Merge and return up to `limit` items.
 */
export async function getRelatedProducts(productId: number, limit = 10) {
  // 1) get category_id
  const [prodRows]: any = await pool.query(
    `SELECT category_id FROM products WHERE id = ? LIMIT 1`,
    [productId]
  );
  const categoryId = prodRows[0] ? prodRows[0].category_id : null;

  const results: any[] = [];

  if (categoryId) {
    const [sameCat]: any = await pool.query(
      `SELECT p.id, p.name, p.price, p.vendor_id,
              COALESCE(s.sold_count,0) AS sold_count,
              (
                SELECT pi2.url FROM product_images pi2
                WHERE pi2.product_id = p.id AND pi2.sort_order = 0
                LIMIT 1
              ) AS image
       FROM products p
       LEFT JOIN (
         SELECT product_id, SUM(quantity) AS sold_count
         FROM order_items
         GROUP BY product_id
       ) s ON s.product_id = p.id
       WHERE p.category_id = ? AND p.id != ?
       ORDER BY sold_count DESC
       LIMIT ?`,
      [categoryId, productId, limit]
    );
    results.push(...(sameCat || []));
  }

  // 2) co-purchase (products bought in same orders)
  const [co]: any = await pool.query(
    `SELECT p.id, p.name, p.price, COALESCE(SUM(oi2.quantity),0) AS co_count,
            (
              SELECT pi2.url FROM product_images pi2
              WHERE pi2.product_id = p.id AND pi2.sort_order = 0
              LIMIT 1
            ) AS image
     FROM order_items oi1
     JOIN order_items oi2
       ON oi2.order_id = oi1.order_id AND oi2.product_id != oi1.product_id
     JOIN products p ON p.id = oi2.product_id
     WHERE oi1.product_id = ?
     GROUP BY p.id
     ORDER BY co_count DESC
     LIMIT ?`,
    [productId, limit]
  );

  const seen = new Set(results.map((r) => r.id));
  for (const r of co || []) {
    if (!seen.has(r.id)) {
      results.push(r);
      seen.add(r.id);
    }
    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}

/** Global ratings summary/distribution */
export async function getRatingsSummary() {
  const [rows]: any = await pool.query(
    `SELECT rating, COUNT(*) AS cnt
     FROM product_reviews
     GROUP BY rating
     ORDER BY rating DESC`
  );
  const [avgRow]: any = await pool.query(
    `SELECT COUNT(*) AS total_reviews, COALESCE(AVG(rating),0) AS average_rating FROM product_reviews`
  );
  return {
    distribution: rows || [],
    summary: avgRow[0] || { total_reviews: 0, average_rating: 0 },
  };
}

/** Recommendations for a user (simple approach)
 * - If user has categories they bought from: recommend popular products inside those categories excluding already bought products
 * - Fallback: global popular products
 */
export async function getRecommendationsForUser(userId: number, limit = 10) {
  const categories = await getUserCategoryDistribution(userId, 3);
  if (!categories || categories.length === 0) {
    return getPopularProducts(limit);
  }

  const [boughtRows]: any = await pool.query(
    `SELECT DISTINCT p.id FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE o.user_id = ?`,
    [userId]
  );
  // perbaikan: boughtRows sudah array rows; jangan pakai boughtRows[0]
  const boughtIds = (boughtRows || []).map((r: any) => r.id);

  const recs: any[] = [];
  for (const c of categories) {
    const params: any[] = [c.category_id];
    let excludeSql = "";
    if (boughtIds.length) {
      excludeSql = `AND p.id NOT IN (${boughtIds.map(() => "?").join(",")})`;
      params.push(...boughtIds);
    }
    params.push(limit);

    const [rows]: any = await pool.query(
      `SELECT p.id, p.name, p.price,
              COALESCE(s.sold_count, 0) AS sold_count,
              (
                SELECT pi2.url FROM product_images pi2
                WHERE pi2.product_id = p.id AND pi2.sort_order = 0
                LIMIT 1
              ) AS image
       FROM products p
       LEFT JOIN (
         SELECT product_id, SUM(quantity) AS sold_count
         FROM order_items
         GROUP BY product_id
       ) s ON s.product_id = p.id
       WHERE p.category_id = ? ${excludeSql}
       ORDER BY sold_count DESC
       LIMIT ?`,
      params
    );

    for (const r of rows || []) {
      if (!recs.find((x) => x.id === r.id)) recs.push(r);
      if (recs.length >= limit) break;
    }
    if (recs.length >= limit) break;
  }

  if (recs.length < limit) {
    const popular = await getPopularProducts(limit - recs.length);
    for (const p of popular) if (!recs.find((x) => x.id === p.id)) recs.push(p);
  }

  return recs.slice(0, limit);
}
