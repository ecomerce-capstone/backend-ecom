import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";
import { query } from "../lib/db"; // ✅ gunakan named import

/**
 * ownershipCheck helper - verifies resource owner or admin bypass
 * - table: table name
 * - idColumn: column name (default 'id')
 * - ownerColumn: e.g., 'vendor_id' or 'user_id'
 * - paramId: request param (default 'id')
 */
export const ownershipCheck = async (
  req: AuthRequest,
  res: Response,
  table: string,
  idColumn = "id",
  ownerColumn = "user_id",
  paramId = "id"
): Promise<boolean> => {
  try {
    const resourceId = req.params[paramId];
    if (!resourceId) {
      res.status(400).json({ error: "Missing resource id param" });
      return false;
    }

    // Admin bypass
    const roles = (req.user && req.user.roles) || [];
    if (roles.includes("admin")) return true;

    // Fetch owner
    const rows: any = await query(
      `SELECT \`${ownerColumn}\` AS owner FROM \`${table}\` WHERE \`${idColumn}\` = ? LIMIT 1`,
      [resourceId]
    );
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "Resource not found" });
      return false;
    }

    if (row.owner == null) {
      res.status(403).json({ error: "Ownership cannot be verified" });
      return false;
    }

    if (req.user.id !== row.owner) {
      res.status(403).json({ error: "Forbidden: not resource owner" });
      return false;
    }

    return true;
  } catch (err: any) {
    console.error("ownershipCheck error:", err.message || err);
    res.status(500).json({ error: "Internal server error" });
    return false;
  }
};
