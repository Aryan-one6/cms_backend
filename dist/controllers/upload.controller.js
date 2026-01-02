"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadImage = uploadImage;
const storage_1 = require("../config/storage");
const path_1 = __importDefault(require("path"));
async function uploadImage(req, res) {
    const file = req.file;
    if (!file)
        return res.status(400).json({ message: "No file uploaded" });
    const filename = file.filename;
    try {
        const key = (0, storage_1.buildUploadKey)(filename);
        const s3Result = await (0, storage_1.uploadToS3)({
            localPath: path_1.default.resolve(file.destination, file.filename),
            key,
            contentType: file.mimetype,
        });
        return res.json({ url: s3Result.url, absoluteUrl: s3Result.absoluteUrl, storage: s3Result.storage });
    }
    catch (err) {
        console.error("Upload failed", err);
        res.status(500).json({ message: "Upload failed", detail: err?.message });
    }
}
