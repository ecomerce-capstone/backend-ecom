// src/routes/cart.ts
import express from "express";
import { body, param, validationResult } from "express-validator";
import { pool } from "../lib/db";
import { requireAuth, AuthRequest } from "../middleware/authMiddleware";
import {
  success,
  error as errorResponse,
  noData,
  mapValidationErrors,
} from "../lib/response";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

/**
 * Helper: read optional cart token from header
 * Client may send X-Cart-Token: <uuid> for guest carts.
 */
function getCartTokenFromReq(req: express.Request) {
  const token =
    (req.headers["x-cart-token"] as string) ||
    (req.body && req.body.cart_token) ||
    null;
  return token;
}

/**
 * GET /cart
 * - If user authenticated -> return their cart (persistent) or a merged cart
 * - If not authenticated but X-Cart-Token provided -> return guest cart
 */
router.get("/", async (req: express.Request, res) => {
  try {
    // If authenticated
    const authHeader = req.headers.authorization;
    let rows: any;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      // use requireAuth in client if you want stricter flow; here we allow both
      // but prefer to ask client call GET /cart with Authorization header when logged in.
    }

    const token = getCartTokenFromReq(req);
    // if token provided -> load cart by token
    if (token) {
      const [cRows]: any = await pool.query(
        "SELECT * FROM carts WHERE token = ? LIMIT 1",
        [token]
      );
      if (!cRows.length) return noData(res, "Cart not found");
      const cart = cRows[0];
      const [items]: any = await pool.query(
        "SELECT * FROM cart_items WHERE cart_id = ?",
        [cart.id]
      );
      cart.items = items;
      return success(res, cart, "Cart fetched", 200);
    }

    // if Authorization provided and token not provided, try to read user cart
    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ")) {
      // validate token via requireAuth is better; but we decode quickly by using middleware
      // For consistency, prefer client call /cart/me with Authorization and we protect it.
      return errorResponse(
        res,
        401,
        "Please call /cart/me with Authorization header"
      );
    }

    // else no data
    return noData(res, "No cart token and no auth provided");
  } catch (err) {
    console.error("GET /cart error", err);
    return errorResponse(res, 500, "Server error fetching cart", [
      { message: "Server error" },
    ]);
  }
});

/**
 * GET /cart/me
 * Authenticated user's cart
 */
router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    const [cRows]: any = await pool.query(
      "SELECT * FROM carts WHERE user_id = ? LIMIT 1",
      [user.id]
    );
    if (!cRows.length) return noData(res, "Cart empty");
    const cart = cRows[0];
    const [items]: any = await pool.query(
      "SELECT * FROM cart_items WHERE cart_id = ?",
      [cart.id]
    );
    cart.items = items;
    return success(res, cart, "User cart fetched", 200);
  } catch (err) {
    console.error("GET /cart/me error", err);
    return errorResponse(res, 500, "Server error", [
      { message: "Server error" },
    ]);
  }
});

/**
 * POST /cart
 * Create or add item to cart. Supports guest (cart_token) or authenticated (req.user)
 * Body: { product_id, quantity, options?, cart_token? }
 */
router.post(
  "/",
  requireAuth, // for simplicity, require auth; to support guest, remove and handle token below
  body("product_id").isInt({ min: 1 }),
  body("quantity").optional().isInt({ min: 1 }),
  async (req: express.Request, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return errorResponse(
        res,
        400,
        "Validation failed",
        mapValidationErrors(errors.array())
      );

    const productId = Number(req.body.product_id);
    const qty = Number(req.body.quantity || 1);
    const token = getCartTokenFromReq(req); // maybe provided or not

    try {
      // fetch product snapshot
      const [pRows]: any = await pool.query(
        "SELECT id, productName AS name, productPrice AS price, images FROM products WHERE id = ? LIMIT 1",
        [productId]
      );
      if (!pRows.length)
        return errorResponse(res, 404, "Product not found", [
          { message: "Product not found" },
        ]);
      const p = pRows[0];

      // parse main image if array stored as JSON or comma
      let imageUrl: string | null = null;
      if (p.images) {
        try {
          const arr =
            typeof p.images === "string" ? JSON.parse(p.images) : p.images;
          if (Array.isArray(arr) && arr.length) imageUrl = arr[0];
        } catch {
          imageUrl = null;
        }
      }

      // Determine cart: if token provided -> guest cart; else if Authorization & user -> user's cart
      let cartId: number | null = null;
      // if token provided
      if (token) {
        const [cRows]: any = await pool.query(
          "SELECT * FROM carts WHERE token = ? LIMIT 1",
          [token]
        );
        if (cRows.length) {
          cartId = cRows[0].id;
        } else {
          // create guest cart with this token (or use provided token)
          await pool.query(
            "INSERT INTO carts (token, created_at, updated_at) VALUES (?, NOW(), NOW())",
            [token]
          );
          const [newRows]: any = await pool.query(
            "SELECT id FROM carts WHERE token = ? LIMIT 1",
            [token]
          );
          cartId = newRows[0].id;
        }
      } else if (
        req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer ")
      ) {
        // If user is authenticated - prefer /cart/me route; but support here if client sends auth
        // We'll check token by using requireAuth style (but not reusing middleware here). Simpler: ask client to call /cart/me.
        return errorResponse(
          res,
          401,
          "Please use /cart/me endpoints when authenticated"
        );
      } else {
        // no token and not authenticated -> create guest token and return to client
        const newToken = uuidv4();
        await pool.query(
          "INSERT INTO carts (token, created_at, updated_at) VALUES (?, NOW(), NOW())",
          [newToken]
        );
        const [newRows]: any = await pool.query(
          "SELECT id FROM carts WHERE token = ? LIMIT 1",
          [newToken]
        );
        cartId = newRows[0].id;
        // add item below and we will return token to client
        // we'll set variable to return token in response
        (req as any)._guest_cart_token = newToken;
      }

      // At this point we have cartId
      // Check if item for same product exists -> update qty
      const [existingItems]: any = await pool.query(
        "SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ? LIMIT 1",
        [cartId, productId]
      );
      if (existingItems.length) {
        const newQty = existingItems[0].quantity + qty;
        await pool.query(
          "UPDATE cart_items SET quantity = ?, updated_at = NOW() WHERE id = ?",
          [newQty, existingItems[0].id]
        );
      } else {
        await pool.query(
          "INSERT INTO cart_items (cart_id, product_id, vendor_id, product_name, product_price, quantity, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
          [
            cartId,
            productId,
            p.vendorId ?? null,
            p.productName ?? p.name ?? null,
            p.productPrice ?? p.price ?? 0.0,
            qty,
            imageUrl,
          ]
        );
      }

      // Recompute cart summary (item_count, total_amount)
      const [agg]: any = await pool.query(
        "SELECT SUM(quantity) as item_count, SUM(product_price * quantity) as total_amount FROM cart_items WHERE cart_id = ?",
        [cartId]
      );
      const itemCount = agg[0]?.item_count ?? 0;
      const totalAmount = agg[0]?.total_amount ?? 0.0;
      await pool.query(
        "UPDATE carts SET item_count = ?, total_amount = ?, updated_at = NOW() WHERE id = ?",
        [itemCount, totalAmount, cartId]
      );

      // Prepare response: return cart info, and if we created guest token return it
      const [cartRows]: any = await pool.query(
        "SELECT * FROM carts WHERE id = ? LIMIT 1",
        [cartId]
      );
      const [itemsRows]: any = await pool.query(
        "SELECT * FROM cart_items WHERE cart_id = ?",
        [cartId]
      );
      const cartResp = cartRows[0];
      cartResp.items = itemsRows;
      const respData: any = cartResp;
      if ((req as any)._guest_cart_token)
        respData.cart_token = (req as any)._guest_cart_token;

      return success(res, respData, "Item added to cart", 201);
    } catch (err) {
      console.error("POST /cart error", err);
      return errorResponse(res, 500, "Server error adding to cart", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * PUT /cart/items/:itemId
 * Update quantity or options of a cart item (guest or user)
 * Body: { quantity }
 */
router.put(
  "/items/:itemId",
  requireAuth, // require auth for simplicity; for guest support, modify to accept token
  [
    param("itemId").isInt({ min: 1 }),
    body("quantity").optional().isInt({ min: 1 }),
  ],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return errorResponse(
        res,
        400,
        "Validation failed",
        mapValidationErrors(errors.array())
      );
    const itemId = Number(req.params.itemId);
    const qty =
      req.body.quantity !== undefined ? Number(req.body.quantity) : null;

    try {
      const user = req.user;
      // ensure item belongs to user's cart
      const [rows]: any = await pool.query(
        `SELECT ci.*, c.user_id FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE ci.id = ? LIMIT 1`,
        [itemId]
      );
      if (!rows.length) return noData(res, "Cart item not found");
      const row = rows[0];
      if (row.user_id !== user.id)
        return errorResponse(res, 403, "Forbidden", [
          { message: "Not your cart item" },
        ]);

      if (qty !== null) {
        await pool.query(
          "UPDATE cart_items SET quantity = ?, updated_at = NOW() WHERE id = ?",
          [qty, itemId]
        );
      }

      // recompute
      const [agg]: any = await pool.query(
        "SELECT SUM(quantity) as item_count, SUM(product_price * quantity) as total_amount FROM cart_items WHERE cart_id = ?",
        [row.cart_id]
      );
      await pool.query(
        "UPDATE carts SET item_count = ?, total_amount = ?, updated_at = NOW() WHERE id = ?",
        [agg[0].item_count ?? 0, agg[0].total_amount ?? 0.0, row.cart_id]
      );

      const [cartRows]: any = await pool.query(
        "SELECT * FROM carts WHERE id = ? LIMIT 1",
        [row.cart_id]
      );
      const [itemsRows]: any = await pool.query(
        "SELECT * FROM cart_items WHERE cart_id = ?",
        [row.cart_id]
      );
      const cartResp = cartRows[0];
      cartResp.items = itemsRows;
      return success(res, cartResp, "Cart item updated", 200);
    } catch (err) {
      console.error("PUT /cart/items/:itemId error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * DELETE /cart/items/:itemId
 */
router.delete(
  "/items/:itemId",
  requireAuth,
  [param("itemId").isInt({ min: 1 })],
  async (req: AuthRequest, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return errorResponse(
        res,
        400,
        "Validation failed",
        mapValidationErrors(errors.array())
      );
    const itemId = Number(req.params.itemId);

    try {
      const user = req.user;
      const [rows]: any = await pool.query(
        `SELECT ci.*, c.user_id FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE ci.id = ? LIMIT 1`,
        [itemId]
      );
      if (!rows.length) return noData(res, "Cart item not found");
      const row = rows[0];
      if (row.user_id !== user.id)
        return errorResponse(res, 403, "Forbidden", [
          { message: "Not your cart item" },
        ]);

      await pool.query("DELETE FROM cart_items WHERE id = ?", [itemId]);
      // recompute cart
      const [agg]: any = await pool.query(
        "SELECT SUM(quantity) as item_count, SUM(product_price * quantity) as total_amount FROM cart_items WHERE cart_id = ?",
        [row.cart_id]
      );
      await pool.query(
        "UPDATE carts SET item_count = ?, total_amount = ?, updated_at = NOW() WHERE id = ?",
        [agg[0].item_count ?? 0, agg[0].total_amount ?? 0.0, row.cart_id]
      );

      const [cartRows]: any = await pool.query(
        "SELECT * FROM carts WHERE id = ? LIMIT 1",
        [row.cart_id]
      );
      const [itemsRows]: any = await pool.query(
        "SELECT * FROM cart_items WHERE cart_id = ?",
        [row.cart_id]
      );
      const cartResp = cartRows[0];
      cartResp.items = itemsRows;
      return success(res, cartResp, "Cart item removed", 200);
    } catch (err) {
      console.error("DELETE /cart/items/:itemId error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/**
 * POST /cart/merge
 * Merge guest cart into authenticated user's cart after login.
 * Body: { cart_token }
 * - server merges items: sum quantities for same product; keep price snapshot from cart_item
 */
router.post(
  "/merge",
  requireAuth,
  body("cart_token").notEmpty(),
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return errorResponse(
        res,
        400,
        "Validation failed",
        mapValidationErrors(errors.array())
      );
    const token = req.body.cart_token;
    try {
      const user = req.user;
      // find guest cart
      const [gRows]: any = await pool.query(
        "SELECT * FROM carts WHERE token = ? LIMIT 1",
        [token]
      );
      if (!gRows.length) return noData(res, "Guest cart not found");

      const guestCart = gRows[0];

      // get or create user cart
      const [uRows]: any = await pool.query(
        "SELECT * FROM carts WHERE user_id = ? LIMIT 1",
        [user.id]
      );
      let userCartId: number;
      if (uRows.length) {
        userCartId = uRows[0].id;
      } else {
        const [ins]: any = await pool.query(
          "INSERT INTO carts (user_id, created_at, updated_at) VALUES (?, NOW(), NOW())",
          [user.id]
        );
        userCartId = ins.insertId;
      }

      // get guest items
      const [gItems]: any = await pool.query(
        "SELECT * FROM cart_items WHERE cart_id = ?",
        [guestCart.id]
      );

      // merge each item into user cart (sum qty if same product)
      for (const it of gItems) {
        const [existing]: any = await pool.query(
          "SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ? LIMIT 1",
          [userCartId, it.product_id]
        );
        if (existing.length) {
          const newQty = existing[0].quantity + it.quantity;
          await pool.query(
            "UPDATE cart_items SET quantity = ?, updated_at = NOW() WHERE id = ?",
            [newQty, existing[0].id]
          );
        } else {
          await pool.query(
            "INSERT INTO cart_items (cart_id, product_id, vendor_id, product_name, product_price, quantity, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
            [
              userCartId,
              it.product_id,
              it.vendor_id,
              it.product_name,
              it.product_price,
              it.quantity,
              it.image_url,
            ]
          );
        }
      }

      // delete guest cart and items
      await pool.query("DELETE FROM cart_items WHERE cart_id = ?", [
        guestCart.id,
      ]);
      await pool.query("DELETE FROM carts WHERE id = ?", [guestCart.id]);

      // recompute user cart summary
      const [agg]: any = await pool.query(
        "SELECT SUM(quantity) as item_count, SUM(product_price * quantity) as total_amount FROM cart_items WHERE cart_id = ?",
        [userCartId]
      );
      await pool.query(
        "UPDATE carts SET item_count = ?, total_amount = ?, updated_at = NOW() WHERE id = ?",
        [agg[0].item_count ?? 0, agg[0].total_amount ?? 0.0, userCartId]
      );

      const [cartRows]: any = await pool.query(
        "SELECT * FROM carts WHERE id = ? LIMIT 1",
        [userCartId]
      );
      const [itemsRows]: any = await pool.query(
        "SELECT * FROM cart_items WHERE cart_id = ?",
        [userCartId]
      );
      const cartResp = cartRows[0];
      cartResp.items = itemsRows;
      return success(res, cartResp, "Cart merged", 200);
    } catch (err) {
      console.error("POST /cart/merge error", err);
      return errorResponse(res, 500, "Server error merging cart", [
        { message: "Server error" },
      ]);
    }
  }
);

export default router;
