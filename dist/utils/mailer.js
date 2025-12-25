"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTransport = createTransport;
exports.sendMail = sendMail;
const nodemailer_1 = __importDefault(require("nodemailer"));
// Basic transport using SMTP. Configure via env.
function createTransport() {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
    if (!SMTP_HOST || !SMTP_PORT) {
        throw new Error("SMTP is not configured");
    }
    return nodemailer_1.default.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: SMTP_SECURE === "true",
        auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
}
async function sendMail(opts) {
    const transport = createTransport();
    await transport.sendMail({
        from: process.env.SMTP_FROM || "no-reply@sapphirecms.local",
        ...opts,
    });
}
