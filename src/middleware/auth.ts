import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { query } from "../lib/db"; // ✅ gunakan named import

export interface AuthRequest extends Request {
  user?: any;
}

/**
 * authenticate - verifies Bearer JWT, attaches `req.user` and `req.user.roles`
 */
export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid Authorization header" });
    }

    const token = authHeader.split(" ")[1];
    const payload: any = jwt.verify(token, process.env.JWT_SECRET as string);
    if (!payload?.id)
      return res.status(401).json({ error: "Invalid token payload" });

    // fetch user
    const users: any = await query(
      "SELECT id, name, email, status, created_at FROM users WHERE id = ?",
      [payload.id]
    );
    const user = users[0];
    if (!user) return res.status(401).json({ error: "User not found" });

    // fetch roles
    const roleRows: any = await query(
      "SELECT r.name FROM roles r JOIN user_has_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?",
      [user.id]
    );
    user.roles = Array.isArray(roleRows)
      ? roleRows.map((r: any) => (r.name ? r.name.toLowerCase() : r))
      : [];

    req.user = user;
    next();
  } catch (err: any) {
    console.error("authenticate error:", err.message || err);
    return res.status(401).json({ error: "Unauthorized" });
  }
};

/**
 * authorizeRole(...roles) - middleware factory to check required roles
 */
export const authorizeRole = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const userRoles = (user.roles || []).map((r: string) => r.toLowerCase());
    const ok = allowedRoles.some((ar) => userRoles.includes(ar.toLowerCase()));
    if (!ok)
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    next();
  };
};
