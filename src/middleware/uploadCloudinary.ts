// src/middleware/uploadCloudinary.ts
import multer from "multer";
import { Request, Response, NextFunction } from "express";
import { error as errorResponse } from "../lib/response";

/**
 * Multer memory storage - store uploaded file in req.file.buffer
 * We'll use Cloudinary to actually persist the file.
 */
/**
 * Penyimpanan memori Multer - menyimpan file yang diunggah di req.file.buffer
 * Kami akan menggunakan Cloudinary untuk menyimpan file secara permanen.
 */

/**
 * Multer memory storage - store uploaded file in req.file.buffer
 * We'll use Cloudinary to actually persist the file.
 */
const storage = multer.memoryStorage();
const uploadSingleImage = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB limit
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
}).single("image");

/**
 * Wrapper to use multer as middleware and respond with standardized error format.
 */
export function multerHandler(req: Request, res: Response, next: NextFunction) {
  return uploadSingleImage(req, res, (err: any) => {
    if (err) {
      // use response helper for consistency
      return errorResponse(res, 400, "File upload error", [
        { message: err.message || "Upload error" },
      ]);
    }
    next();
  });
}

/*
Field name yang dipakai: image. Pastikan frontend mengirim file di field image.

Batas ukuran 5MB — ubah sesuai kebutuhan.

*/
// file filter: only images
function fileFilter(
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  if (!file.mimetype.startsWith("image/")) {
    return cb(new Error("Only image files are allowed"));
  }
  cb(null, true);
}

// limits: max file size 5MB (adjust as needed)
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});
