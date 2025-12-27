import { S3Client, PutObjectCommand, type ObjectCannedACL } from "@aws-sdk/client-s3";
import path from "path";
import fs from "fs/promises";

type UploadResult = { url: string };

function hasS3Env() {
  return Boolean(
    process.env.S3_BUCKET &&
    process.env.S3_REGION &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  );
}

export function getS3Client() {
  if (!hasS3Env()) return null;
  return new S3Client({
    region: process.env.S3_REGION!,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

export async function uploadToS3(opts: { localPath?: string; fileBuffer?: Buffer; key: string; contentType: string }) {
  const client = getS3Client();
  if (!client) throw new Error("S3 not configured");

  let body: Buffer;
  if (opts.fileBuffer) {
    body = opts.fileBuffer;
  } else if (opts.localPath) {
    body = await fs.readFile(opts.localPath);
  } else {
    throw new Error("Upload failed: provide either localPath or fileBuffer");
  }

  const bucket = process.env.S3_BUCKET!;
  const acl: ObjectCannedACL = (process.env.S3_ACL as ObjectCannedACL | undefined) ?? "public-read";
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: opts.key,
    Body: body,
    ContentType: opts.contentType,
    ACL: acl,
  });
  await client.send(command);

  const base = process.env.S3_CDN_BASE || `https://${bucket}.s3.${process.env.S3_REGION}.amazonaws.com`;
  const url = `${base.replace(/\/$/, "")}/${opts.key}`;
  return { url } as UploadResult;
}

export function buildLocalUrl(filename: string, reqOrigin: string) {
  const relative = `/uploads/${filename}`;
  return {
    relative,
    absolute: new URL(relative, reqOrigin).toString(),
  };
}

export function buildUploadKey(filename: string) {
  const prefix = process.env.S3_PREFIX?.replace(/\/+$/, "") || "uploads";
  return `${prefix}/${filename}`;
}
