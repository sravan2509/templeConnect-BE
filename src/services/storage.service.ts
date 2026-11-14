import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

/** Where locally stored uploads live when S3 isn't configured (served at /uploads). */
export const LOCAL_UPLOAD_DIR = path.resolve(__dirname, "../../uploads");

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

let client: S3Client | null = null;

export function isS3Configured(): boolean {
  return !!(env.s3.bucket && env.s3.region && env.s3.accessKeyId && env.s3.secretAccessKey);
}

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env.s3.region,
      credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
    });
  }
  return client;
}

/** Checks the real file signature, not just the client-declared type. */
function sniffImage(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Stores an uploaded image (event poster, temple/service photo) and returns its public URL.
 * Uses S3 when configured; otherwise saves to the API server's disk (development / small installs).
 */
export async function storeImage(buffer: Buffer, folder: "events" | "temples" | "services" | "festivals"): Promise<string> {
  if (!buffer?.length) throw new AppError("No image was uploaded");
  if (buffer.length > MAX_IMAGE_BYTES) throw new AppError("Image is too large (max 5 MB)");
  const type = sniffImage(buffer);
  if (!type) throw new AppError("Only JPG, PNG or WebP images are allowed");

  const name = `${folder}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${IMAGE_TYPES[type]}`;

  if (isS3Configured()) {
    const key = env.s3.prefix ? `${env.s3.prefix}/${name}` : name;
    try {
      await s3().send(new PutObjectCommand({
        Bucket: env.s3.bucket, Key: key, Body: buffer, ContentType: type, CacheControl: "public, max-age=31536000, immutable",
      }));
    } catch (err: any) {
      console.error(`[S3] Upload failed: ${err.message}`);
      throw new AppError("Image upload failed. Please try again.", 502);
    }
    const base = env.s3.publicBaseUrl || `https://${env.s3.bucket}.s3.${env.s3.region}.amazonaws.com`;
    return `${base}/${key}`;
  }

  if (env.isProduction) throw new AppError("Image storage is not configured", 503);
  const file = path.join(LOCAL_UPLOAD_DIR, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buffer);
  // Relative, so it keeps working when the API host changes; the app resolves it against its API URL.
  return `/uploads/${name}`;
}
