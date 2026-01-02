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
const authTokens_1 = require("../utils/authTokens");
const zod_1 = require("zod");
const prisma_1 = require("../config/prisma");
const mailer_1 = require("../utils/mailer");
const crypto_1 = __importDefault(require("crypto"));
const client_1 = require("@prisma/client");
const crypto_2 = require("crypto");
const accountSubscription_1 = require("../utils/accountSubscription");
const ensureDefaultSite_1 = require("../utils/ensureDefaultSite");
const slugify_1 = __importDefault(require("slugify"));
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
});
const signupSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
    siteName: zod_1.z.string().min(2),
    domain: zod_1.z.string().min(3),
});
const resetRequestSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
});
const resetConfirmSchema = zod_1.z.object({
    token: zod_1.z.string().min(10),
    password: zod_1.z.string().min(6),
});
function normalizeDomain(domain) {
    return domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}
function generateDomainToken() {
    return (0, crypto_2.randomBytes)(16).toString("hex");
}
async function login(req, res) {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const { email, password } = parsed.data;
    const admin = await prisma_1.prisma.adminUser.findUnique({ where: { email } });
    if (!admin)
        return res.status(401).json({ message: "Invalid credentials" });
    if (!admin.passwordHash) {
        return res.status(401).json({ message: "This account uses Google/GitHub login." });
    }
    const ok = await bcrypt_1.default.compare(password, admin.passwordHash);
    if (!ok)
        return res.status(401).json({ message: "Invalid credentials" });
    await (0, ensureDefaultSite_1.ensureDefaultSite)(admin.id, admin.name);
    await (0, accountSubscription_1.ensureAccountSubscription)(admin.id);
    const token = (0, authTokens_1.signAdminToken)({ adminId: admin.id, role: admin.role });
    // cookie-based auth (best for admin panel)
    res.cookie("accessToken", token, (0, authTokens_1.getCookieOptions)());
    return res.json({
        admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    });
}
async function signup(req, res) {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const { name, email, password, siteName, domain } = parsed.data;
    const existing = await prisma_1.prisma.adminUser.findUnique({ where: { email } });
    if (existing)
        return res.status(400).json({ message: "Email already in use" });
    const passwordHash = await bcrypt_1.default.hash(password, 10);
    const admin = await prisma_1.prisma.adminUser.create({
        data: { name, email, passwordHash, role: "EDITOR" },
    });
    // Create primary site using provided info
    let slug = (0, slugify_1.default)(siteName, { lower: true, strict: true });
    let i = 1;
    while (true) {
        const exists = await prisma_1.prisma.site.findUnique({ where: { slug } });
        if (!exists)
            break;
        slug = `${(0, slugify_1.default)(siteName, { lower: true, strict: true })}-${i++}`;
    }
    const primaryDomain = normalizeDomain(domain);
    const site = await prisma_1.prisma.site.create({
        data: { name: siteName, slug, domains: primaryDomain ? [primaryDomain] : [] },
    });
    await prisma_1.prisma.adminSiteMembership.create({
        data: { adminId: admin.id, siteId: site.id, role: client_1.SiteRole.OWNER },
    });
    if (primaryDomain) {
        await prisma_1.prisma.siteDomain.create({
            data: {
                siteId: site.id,
                domain: primaryDomain,
                verificationToken: generateDomainToken(),
                status: "PENDING",
            },
        });
    }
    await prisma_1.prisma.adminUser.update({ where: { id: admin.id }, data: { primarySiteId: site.id } });
    await (0, accountSubscription_1.ensureAccountSubscription)(admin.id);
    const token = (0, authTokens_1.signAdminToken)({ adminId: admin.id, role: admin.role });
    res.cookie("accessToken", token, (0, authTokens_1.getCookieOptions)());
    return res.status(201).json({
        admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    });
}
async function me(req, res) {
    const auth = req.auth;
    const admin = await prisma_1.prisma.adminUser.findUnique({
        where: { id: auth.adminId },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
            avatarUrl: true,
            accountSubscription: {
                select: { plan: true, status: true, expiresAt: true, startedAt: true },
            },
        },
    });
    if (admin && !admin.accountSubscription) {
        await (0, accountSubscription_1.ensureAccountSubscription)(admin.id);
        const refreshed = await prisma_1.prisma.adminUser.findUnique({
            where: { id: auth.adminId },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                createdAt: true,
                avatarUrl: true,
                accountSubscription: {
                    select: { plan: true, status: true, expiresAt: true, startedAt: true },
                },
            },
        });
        return res.json({ admin: refreshed });
    }
    return res.json({ admin });
}
async function logout(_req, res) {
    const opts = (0, authTokens_1.getCookieOptions)();
    res.clearCookie("accessToken", opts);
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
    const baseUrl = (process.env.APP_ORIGIN || "http://localhost:5173")
        .split(",")[0]
        .trim()
        .replace(/\/+$/, "") || "http://localhost:5173";
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
