import { S3Client, PutObjectCommand, type ObjectCannedACL } from "@aws-sdk/client-s3";
import path from "path";
import fs from "fs/promises";

type UploadResult = { url: string; absoluteUrl: string; storage: "s3" | "local" };

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
  if (!client) {
    const filename = path.basename(opts.key);
    const relative = `/uploads/${filename}`;
    const baseOrigin =
      process.env.APP_ORIGIN?.replace(/\/+$/, "") || `http://localhost:${process.env.PORT || 5050}`;
    const absolute = `${baseOrigin}${relative}`;
    return { url: relative, absoluteUrl: absolute, storage: "local" } satisfies UploadResult;
  }

  let body: Buffer;
  if (opts.fileBuffer) {
    body = opts.fileBuffer;
  } else if (opts.localPath) {
    body = await fs.readFile(opts.localPath);
  } else {
    throw new Error("Upload failed: provide either localPath or fileBuffer");
  }

  const bucket = process.env.S3_BUCKET!;
  const aclEnv = (process.env.S3_ACL || "").trim().toLowerCase();
  const acl: ObjectCannedACL | undefined =
    !aclEnv || aclEnv === "none" || aclEnv === "skip" ? undefined : (aclEnv as ObjectCannedACL);
  const command = new PutObjectCommand(
    {
      Bucket: bucket,
      Key: opts.key,
      Body: body,
      ContentType: opts.contentType,
      ...(acl ? { ACL: acl } : {}), // Skip ACL if bucket blocks public ACLs
    } as any
  );
  await client.send(command);

  const base = process.env.S3_CDN_BASE || `https://${bucket}.s3.${process.env.S3_REGION}.amazonaws.com`;
  const url = `${base.replace(/\/$/, "")}/${opts.key}`;
  return { url, absoluteUrl: url, storage: "s3" } as UploadResult;
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
