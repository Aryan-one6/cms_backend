"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getS3Client = getS3Client;
exports.uploadToS3 = uploadToS3;
exports.buildLocalUrl = buildLocalUrl;
exports.buildUploadKey = buildUploadKey;
const client_s3_1 = require("@aws-sdk/client-s3");
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
function hasS3Env() {
    return Boolean(process.env.S3_BUCKET &&
        process.env.S3_REGION &&
        process.env.AWS_ACCESS_KEY_ID &&
        process.env.AWS_SECRET_ACCESS_KEY);
}
function getS3Client() {
    if (!hasS3Env())
        return null;
    return new client_s3_1.S3Client({
        region: process.env.S3_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
    });
}
async function uploadToS3(opts) {
    const client = getS3Client();
    if (!client) {
        const filename = path_1.default.basename(opts.key);
        const relative = `/uploads/${filename}`;
        const baseOrigin = process.env.APP_ORIGIN?.split(",")[0]?.trim().replace(/\/+$/, "") ||
            `http://localhost:${process.env.PORT || 5050}`;
        const absolute = `${baseOrigin}${relative}`;
        return { url: relative, absoluteUrl: absolute, storage: "local" };
    }
    let body;
    if (opts.fileBuffer) {
        body = opts.fileBuffer;
    }
    else if (opts.localPath) {
        body = await promises_1.default.readFile(opts.localPath);
    }
    else {
        throw new Error("Upload failed: provide either localPath or fileBuffer");
    }
    const bucket = process.env.S3_BUCKET;
    const aclEnv = (process.env.S3_ACL || "").trim().toLowerCase();
    const acl = !aclEnv || aclEnv === "none" || aclEnv === "skip" ? undefined : aclEnv;
    const command = new client_s3_1.PutObjectCommand({
        Bucket: bucket,
        Key: opts.key,
        Body: body,
        ContentType: opts.contentType,
        ...(acl ? { ACL: acl } : {}), // Skip ACL if bucket blocks public ACLs
    });
    await client.send(command);
    const base = process.env.S3_CDN_BASE || `https://${bucket}.s3.${process.env.S3_REGION}.amazonaws.com`;
    const url = `${base.replace(/\/$/, "")}/${opts.key}`;
    return { url, absoluteUrl: url, storage: "s3" };
}
function buildLocalUrl(filename, reqOrigin) {
    const relative = `/uploads/${filename}`;
    return {
        relative,
        absolute: new URL(relative, reqOrigin).toString(),
    };
}
function buildUploadKey(filename) {
    const prefix = process.env.S3_PREFIX?.replace(/\/+$/, "") || "uploads";
    return `${prefix}/${filename}`;
}
