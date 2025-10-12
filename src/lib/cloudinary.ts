//helped for upload buffers to cloudinary

//src/lib/cloudinary.ts

import { v2 as cloudinaryV2, UploadApiResponse } from "cloudinary";
import streamifier from "streamifier";

cloudinaryV2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export const uploadBufferToCloudinary = (
  buffer: Buffer,
  options: { folder?: string; public_id?: string } = {}
): Promise<UploadApiResponse> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinaryV2.uploader.upload_stream(
      {
        folder: options.folder,
        public_id: options.public_id,
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error("No result from Cloudinary"));

        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

/**
 * Delete image from Cloudinary by public_id safely.
 * Returns true if success, false if not found or failed.
 */
export async function deleteFromCloudinary(publicId: string): Promise<boolean> {
  if (!publicId) return false;
  try {
    const res: UploadApiResponse = await cloudinaryV2.uploader.destroy(
      publicId,
      {
        resource_type: "image",
      }
    );
    if (res.result === "ok" || res.result === "not found") {
      console.log(`[Cloudinary] Deleted: ${publicId}`);
      return true;
    }
    console.warn(`[Cloudinary] Delete failed: ${publicId}`, res);
    return false;
  } catch (err) {
    console.error(`[Cloudinary] Delete error for ${publicId}:`, err);
    return false;
  }
}
