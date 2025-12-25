"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
exports.signup = signup;
exports.me = me;
exports.logout = logout;
exports.requestPasswordReset = requestPasswordReset;
exports.confirmPasswordReset = confirmPasswordReset;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const prisma_1 = require("../config/prisma");
const mailer_1 = require("../utils/mailer");
const crypto_1 = __importDefault(require("crypto"));
const slugify_1 = __importDefault(require("slugify"));
const client_1 = require("@prisma/client");
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
});
const signupSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
});
const resetRequestSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
});
const resetConfirmSchema = zod_1.z.object({
    token: zod_1.z.string().min(10),
    password: zod_1.z.string().min(6),
});
async function ensureDefaultSite(adminId, adminName) {
    const existingSite = await prisma_1.prisma.adminSiteMembership.findFirst({ where: { adminId } });
    if (existingSite)
        return;
    let base = adminName || "Main Site";
    if (base.length < 3)
        base = "site";
    let slug = (0, slugify_1.default)(base, { lower: true, strict: true });
    let i = 1;
    while (true) {
        const exists = await prisma_1.prisma.site.findUnique({ where: { slug } });
        if (!exists)
            break;
        slug = `${(0, slugify_1.default)(base, { lower: true, strict: true })}-${i++}`;
    }
    const site = await prisma_1.prisma.site.create({
        data: { name: `${adminName || "My"} Site`, slug, domains: [] },
    });
    await prisma_1.prisma.adminSiteMembership.create({
        data: { adminId, siteId: site.id, role: client_1.SiteRole.OWNER },
    });
}
function getJwtConfig() {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        throw new Error("JWT secret is not configured");
    }
    const expiresIn = process.env.JWT_EXPIRES_IN ?? "7d";
    return { jwtSecret, expiresIn };
}
async function login(req, res) {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const { email, password } = parsed.data;
    const { jwtSecret, expiresIn } = getJwtConfig();
    const admin = await prisma_1.prisma.adminUser.findUnique({ where: { email } });
    if (!admin)
        return res.status(401).json({ message: "Invalid credentials" });
    const ok = await bcrypt_1.default.compare(password, admin.passwordHash);
    if (!ok)
        return res.status(401).json({ message: "Invalid credentials" });
    await ensureDefaultSite(admin.id, admin.name);
    const token = jsonwebtoken_1.default.sign({ adminId: admin.id, role: admin.role }, jwtSecret, { expiresIn });
    // cookie-based auth (best for admin panel)
    res.cookie("accessToken", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.json({
        admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    });
}
async function signup(req, res) {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const { name, email, password } = parsed.data;
    const existing = await prisma_1.prisma.adminUser.findUnique({ where: { email } });
    if (existing)
        return res.status(400).json({ message: "Email already in use" });
    const passwordHash = await bcrypt_1.default.hash(password, 10);
    const admin = await prisma_1.prisma.adminUser.create({
        data: { name, email, passwordHash, role: "EDITOR" },
    });
    await ensureDefaultSite(admin.id, admin.name);
    const { jwtSecret, expiresIn } = getJwtConfig();
    const token = jsonwebtoken_1.default.sign({ adminId: admin.id, role: admin.role }, jwtSecret, { expiresIn });
    res.cookie("accessToken", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.status(201).json({
        admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    });
}
async function me(req, res) {
    const auth = req.auth;
    const admin = await prisma_1.prisma.adminUser.findUnique({
        where: { id: auth.adminId },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    return res.json({ admin });
}
async function logout(_req, res) {
    res.clearCookie("accessToken");
    return res.json({ ok: true });
}
async function requestPasswordReset(req, res) {
    const parsed = resetRequestSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const admin = await prisma_1.prisma.adminUser.findUnique({ where: { email: parsed.data.email } });
    if (!admin)
        return res.json({ ok: true }); // do not reveal existence
    const token = crypto_1.default.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 30); // 30 mins
    await prisma_1.prisma.adminUser.update({
        where: { id: admin.id },
        data: { resetToken: token, resetExpires: expires },
    });
    const baseUrl = process.env.APP_ORIGIN || "http://localhost:5173";
    const resetLink = `${baseUrl}/reset-password?token=${token}`;
    const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT);
    if (hasSmtp) {
        try {
            await (0, mailer_1.sendMail)({
                to: admin.email,
                subject: "Reset your Sapphire CMS password",
                html: `<p>Hello ${admin.name},</p><p>Click the link to reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p><p>This link expires in 30 minutes.</p>`,
            });
        }
        catch (err) {
            console.error("Mailer error", err);
            // Do not block the flow; still allow reset by returning the link in non-production for debugging.
            if (process.env.NODE_ENV !== "production") {
                return res.json({ ok: true, resetLink });
            }
        }
    }
    else {
        console.warn("SMTP not configured; cannot send reset email. Reset link:", resetLink);
        if (process.env.NODE_ENV !== "production") {
            return res.json({ ok: true, resetLink });
        }
    }
    return res.json({ ok: true });
}
async function confirmPasswordReset(req, res) {
    const parsed = resetConfirmSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const { token, password } = parsed.data;
    const admin = await prisma_1.prisma.adminUser.findFirst({
        where: { resetToken: token, resetExpires: { gt: new Date() } },
    });
    if (!admin)
        return res.status(400).json({ message: "Invalid or expired token" });
    const passwordHash = await bcrypt_1.default.hash(password, 10);
    await prisma_1.prisma.adminUser.update({
        where: { id: admin.id },
        data: { passwordHash, resetToken: null, resetExpires: null },
    });
    return res.json({ ok: true });
}
