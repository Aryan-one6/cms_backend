import { Request, Response } from "express";
import { uploadToS3, buildUploadKey } from "../config/storage";
import path from "path";

export async function uploadImage(req: Request, res: Response) {
  const file = (req as any).file as Express.Multer.File | undefined;

  if (!file) return res.status(400).json({ message: "No file uploaded" });

  const filename = file.filename;

  try {
    const key = buildUploadKey(filename);
    const s3Result = await uploadToS3({
      localPath: path.resolve(file.destination, file.filename),
      key,
      contentType: file.mimetype,
    });
    return res.json({ url: s3Result.url, absoluteUrl: s3Result.absoluteUrl, storage: s3Result.storage });
  } catch (err: any) {
    console.error("Upload failed", err);
    res.status(500).json({ message: "Upload failed", detail: err?.message });
  }
}
