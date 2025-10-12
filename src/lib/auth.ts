import jwt, { SignOptions, Secret } from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

//catatan utk versi terbaru dari jsonwebtoken 9 sebaiknya gunakan SignOptions dan Secret
//sebab tanpa itu akan ada warning

const JWT_SECRET: Secret = process.env.JWT_SECRET || "change_me";
const JWT_EXPIRES_IN: SignOptions["expiresIn"] =
  (process.env.JWT_EXPIRES_IN as SignOptions["expiresIn"]) ?? "1h";

const RESET_JWT_SECRET: Secret =
  process.env.RESET_JWT_SECRET || (JWT_SECRET as string) + "_reset";
const RESET_JWT_EXPIRES_IN: SignOptions["expiresIn"] =
  (process.env.RESET_JWT_EXPIRES_IN as SignOptions["expiresIn"]) ?? "1h";

/**
 * signAuthToken
 * - payload: object (claims)
 * - returns: JWT string
 */

export function signAuthToken(payload: object) {
  const opts: SignOptions = { expiresIn: JWT_EXPIRES_IN };
  // cast secret to Secret to satisfy overload resolution
  return jwt.sign(
    payload as jwt.JwtPayload | string,
    JWT_SECRET as Secret,
    opts
  );
}

//fungsi utk verifikasi token
//jika token valid maka mengembalikan payload
//jika tidak valid maka melempar error
//payload bisa diakses melalui req.user jika menggunakan middleware authenticateToken
//di routes/auth.ts
//bisa juga langsung menggunakan fungsi ini di route handler utk verifikasi manual
//misal utk reset password
//dengan memanggil verifyAuthToken(req.body.token) atau sejenisnya
//dan menangkap errornya jika token tidak valid

export function verifyAuthToken(token: string) {
  //return decode payload jika token valid
  return jwt.verify(token, JWT_SECRET as Secret);
}

//signResetToken utk membuat token reset password
//verifyResetToken utk verifikasi token reset password
//biasanya dipakai di route handler reset password
export function signResetToken(payload: object) {
  const opts: SignOptions = { expiresIn: RESET_JWT_EXPIRES_IN };
  return jwt.sign(
    payload as jwt.JwtPayload | string,
    RESET_JWT_SECRET as Secret,
    opts
  );
}

//untuk memastikan token valid sebelum mengizinkan user mengganti passwordnya
export function verifyResetToken(token: string) {
  return jwt.verify(token, RESET_JWT_SECRET);
}
