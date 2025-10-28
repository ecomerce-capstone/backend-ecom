// src/routes/auth.ts
import express from "express";
import { body, validationResult } from "express-validator";
import { pool } from "../lib/db";
import { hashPassword, comparePassword } from "../utils/hash";
import { signAuthToken, signResetToken, verifyResetToken } from "../lib/auth";
import { sendMail } from "../lib/mailer";
import dotenv from "dotenv";
import {
  success,
  error as errorResponse,
  mapValidationErrors,
} from "../lib/response";
dotenv.config();

const router = express.Router();

/**
 * helper: central validation handler using mapValidationErrors
 */
const handleValidation = <T = any>(
  req: express.Request<any, any, T, any>,
  res: express.Response
): boolean => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const mapped = mapValidationErrors(errors.array());
    errorResponse(res, 400, "validation failed", mapped);
    return false;
  }
  return true;
};

/** Register customer / user */
/**
 * Replace existing register handlers in src/routes/auth.ts with the following transactional versions.
 * Assumes: pool, hashPassword, signAuthToken, success, errorResponse, handleValidation are imported/available.
 */

//
// REGISTER CUSTOMER (transactional, assigns role via user_has_roles)
//
router.post(
  "/register",
  body("fullName").isLength({ min: 2 }),
  body("email").isEmail(),
  body("password").isLength({ min: 8 }),
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { fullName, email: rawEmail, password } = req.body;
    const email = String(rawEmail).toLowerCase();

    let conn: any;
    try {
      // Check duplicates first (users and vendors)
      const [uExisting]: any = await pool.query(
        "SELECT id FROM users WHERE email = ? LIMIT 1",
        [email]
      );
      const [vExisting]: any = await pool.query(
        "SELECT id FROM vendors WHERE email = ? LIMIT 1",
        [email]
      );
      if ((uExisting && uExisting.length) || (vExisting && vExisting.length)) {
        return errorResponse(res, 409, "Email already registered", [
          { field: "email", message: "Email already registered" },
        ]);
      }

      // Acquire connection and start transaction
      conn = await pool.getConnection();
      await conn.beginTransaction();

      // Insert user
      const hashed = await hashPassword(password);
      const [result]: any = await conn.query(
        "INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)",
        [String(fullName).trim(), email, hashed]
      );
      const userId = result.insertId;

      // Assign default role (customer) in user_has_roles
      // role_id = 1 is assumed to be 'customer' (seed roles beforehand)
      await conn.query(
        "INSERT IGNORE INTO user_has_roles (user_id, role_id) VALUES (?, ?)",
        [userId, 1]
      );

      // Commit transaction
      await conn.commit();

      // Sign token
      const token = signAuthToken({ id: userId, role: "customer", email });

      return success(res, { id: userId, token }, "Registered", 201);
    } catch (err) {
      console.error("Register error (transactional)", err);
      if (conn) {
        try {
          await conn.rollback();
        } catch (rbErr) {
          console.error("Rollback error", rbErr);
        }
      }
      // detect duplicate entry error (MySQL ER_DUP_ENTRY = 1062)
      if (
        (err as any)?.code === "ER_DUP_ENTRY" ||
        (err as any)?.errno === 1062
      ) {
        return errorResponse(res, 409, "Email already registered", [
          { field: "email", message: "Email already registered" },
        ]);
      }
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    } finally {
      if (conn) conn.release();
    }
  }
);

//
// REGISTER VENDOR (transactional for vendor table only)
// - vendors remain separate; no user_has_roles insertion here.
// - we still check for duplicate email across users & vendors before insert.
//
router.post(
  "/register/vendor",
  body("name").isLength({ min: 2 }),
  body("email").isEmail(),
  body("password").isLength({ min: 8 }),
  body("storeName").isLength({ min: 2 }),
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const {
      name,
      email: rawEmail,
      password,
      phone,
      storeName,
      storeDescription,
    } = req.body;
    const email = String(rawEmail).toLowerCase();

    let conn: any;
    try {
      // Check duplicates across both tables
      const [uExisting]: any = await pool.query(
        "SELECT id FROM users WHERE email = ? LIMIT 1",
        [email]
      );
      const [vExisting]: any = await pool.query(
        "SELECT id FROM vendors WHERE email = ? LIMIT 1",
        [email]
      );
      if ((uExisting && uExisting.length) || (vExisting && vExisting.length)) {
        return errorResponse(res, 409, "Email already registered as vendor", [
          { field: "email", message: "Email already registered" },
        ]);
      }

      // transactionally insert vendor row
      conn = await pool.getConnection();
      await conn.beginTransaction();

      const hashed = await hashPassword(password);
      const [result]: any = await conn.query(
        `INSERT INTO vendors (name, email, password, phone, store_name, store_description)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          String(name).trim(),
          email,
          hashed,
          phone || null,
          String(storeName).trim(),
          storeDescription ? String(storeDescription).trim() : null,
        ]
      );
      const vendorId = result.insertId;

      // (Optional) If you later want to maintain vendor->roles in pivot, insert here:
      // await conn.query("INSERT IGNORE INTO user_has_roles (user_id, role_id) VALUES (?, ?)", [vendorId, 2]);

      await conn.commit();

      const token = signAuthToken({ id: vendorId, role: "vendor", email });

      return success(res, { id: vendorId, token }, "Vendor Registered", 201);
    } catch (err) {
      console.error("Vendor register error (transactional)", err);
      if (conn) {
        try {
          await conn.rollback();
        } catch (rbErr) {
          console.error("Rollback error", rbErr);
        }
      }
      if (
        (err as any)?.code === "ER_DUP_ENTRY" ||
        (err as any)?.errno === 1062
      ) {
        return errorResponse(res, 409, "Email already registered", [
          { field: "email", message: "Email already registered" },
        ]);
      }
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    } finally {
      if (conn) conn.release();
    }
  }
);

// login user/customer atau vendor
router.post(
  "/login",
  body("email").isEmail(),
  body("password").isLength({ min: 8 }),
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { email: rawEmail, password, role } = req.body;
    const email = String(rawEmail).toLowerCase();
    try {
      if (role === "vendor") {
        // select id, password, email
        const [rows]: any = await pool.query(
          "SELECT id, password, email FROM vendors WHERE email = ? LIMIT 1",
          [email]
        );
        if (!rows.length)
          return errorResponse(res, 401, "Invalid credentials", [
            { message: "Invalid credentials" },
          ]);
        const v = rows[0];
        const ok = await comparePassword(password, v.password);
        if (!ok)
          return errorResponse(res, 401, "Invalid credentials", [
            { message: "Invalid credentials" },
          ]);
        const token = signAuthToken({
          id: v.id,
          role: "vendor",
          email: v.email || email,
        });
        return success(res, { id: v.id, token }, "Logged in", 200);
      }

      // default: customer
      const [rows]: any = await pool.query(
        "SELECT id, password, email FROM users WHERE email = ? LIMIT 1",
        [email]
      );
      if (!rows.length)
        return errorResponse(res, 401, "Invalid credentials", [
          { message: "Invalid credentials" },
        ]);
      const u = rows[0];
      const ok = await comparePassword(password, u.password);
      if (!ok)
        return errorResponse(res, 401, "Invalid credentials", [
          { message: "Invalid credentials" },
        ]);
      const token = signAuthToken({
        id: u.id,
        role: "customer",
        email: u.email || email,
      });
      return success(res, { id: u.id, token }, "Logged in", 200);
    } catch (err) {
      console.error("Login error", err);
      return errorResponse(res, 500, "Server error", [
        { message: "Server error" },
      ]);
    }
  }
);

/* forgot password */
router.post("/forgot-password", body("email").isEmail(), async (req, res) => {
  if (!handleValidation(req, res)) return;
  const rawEmail = req.body.email;
  const email = String(rawEmail).toLowerCase();
  try {
    const [uRows]: any = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );
    const [vRows]: any = await pool.query(
      "SELECT id FROM vendors WHERE email = ?",
      [email]
    );
    if (!uRows.length && !vRows.length) {
      // do not reveal account existence
      return success(
        res,
        null,
        "If an account exists, a reset link was sent",
        200
      );
    }

    const payloads: any[] = [];
    if (uRows.length) payloads.push({ id: uRows[0].id, role: "customer" });
    if (vRows.length) payloads.push({ id: vRows[0].id, role: "vendor" });

    for (const p of payloads) {
      const token = signResetToken({ id: p.id, role: p.role, email });
      // Compose reset link and send email
      const link = `${req.protocol}://${req.get(
        "host"
      )}/reset-password?token=${token}&role=${p.role}`;
      const html = `<p>Kami menerima permintaan untuk mereset password Anda. Klik tautan berikut untuk mereset password Anda:</p><p><a href="${link}">${link}</a></p>`;
      await sendMail(email, "Password Reset", html);
    }

    return success(
      res,
      null,
      "If an account exists, a reset link was sent",
      200
    );
  } catch (err) {
    console.error("Forgot password error", err);
    return errorResponse(res, 500, "Server error", [
      { message: "Server error" },
    ]);
  }
});

/* reset password */
router.post(
  "/reset-password",
  body("token").notEmpty(),
  body("password").isLength({ min: 8 }),
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { token, password } = req.body;
    try {
      const decoded = verifyResetToken(token) as any;
      if (!decoded || !decoded.id || !decoded.role)
        return errorResponse(res, 400, "Invalid or Expired token", [
          { message: "Invalid or Expired token" },
        ]);
      const hashed = await hashPassword(password);
      if (decoded.role === "customer") {
        await pool.query("UPDATE users SET password = ? WHERE id = ?", [
          hashed,
          decoded.id,
        ]);
      } else if (decoded.role === "vendor") {
        await pool.query("UPDATE vendors SET password = ? WHERE id = ?", [
          hashed,
          decoded.id,
        ]);
      } else {
        return errorResponse(res, 400, "Invalid role in token", [
          { message: "Invalid role in token" },
        ]);
      }
      return success(res, null, "Password has been reset", 200);
    } catch (err) {
      console.error("Reset password error", err);
      return errorResponse(res, 400, "Invalid or Expired token", [
        { message: "Invalid or Expired token" },
      ]);
    }
  }
);

export default router;
