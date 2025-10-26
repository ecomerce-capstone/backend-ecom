import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();
export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "emarket_multivendor",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

//helper to run single query
/**
 * Generic query helper.
 * Usage:
 *   const rows = await query<UserRow>('SELECT id, name FROM users WHERE id = ?', [id]);
 * Returns: Promise<T[]>
 */
export async function query<T = any>(
  sql: string,
  params: any[] = []
): Promise<T[]> {
  //pool is connection
  //and query is method to run query
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}
