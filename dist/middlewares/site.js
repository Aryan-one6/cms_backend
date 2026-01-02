"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSiteAccess = requireSiteAccess;
exports.requirePublicSiteToken = requirePublicSiteToken;
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../config/prisma");
function getSiteId(req) {
    return (req.header("x-site-id") ||
        req.query.siteId ||
        req.body?.siteId ||
        req.params?.siteId ||
        req.params?.id ||
        "")
        .toString()
        .trim();
}
async function requireSiteAccess(req, res, next) {
    const siteId = getSiteId(req);
    if (!siteId)
        return res.status(400).json({ message: "Missing site id" });
    const auth = req.auth;
    if (!auth)
        return res.status(401).json({ message: "Unauthorized" });
    const membership = await prisma_1.prisma.adminSiteMembership.findFirst({
        where: { siteId, adminId: auth.adminId },
    });
    const isSuperAdmin = auth.role === "SUPER_ADMIN";
    if (!membership && !isSuperAdmin) {
        return res.status(403).json({ message: "You do not have access to this site" });
    }
    req.site = {
        siteId,
        membershipRole: membership?.role ?? null,
    };
    next();
}
async function requirePublicSiteToken(req, res, next) {
    const token = (req.header("x-site-token") || req.query.token || "").toString().trim();
    if (!token)
        return res.status(401).json({ message: "Missing site token" });
    const hashed = crypto_1.default.createHash("sha256").update(token).digest("hex");
    const apiToken = await prisma_1.prisma.apiToken.findFirst({
        where: {
            hashed,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
    });
    if (!apiToken)
        return res.status(401).json({ message: "Invalid or expired site token" });
    // Async but non-blocking last used update
    prisma_1.prisma.apiToken
        .update({ where: { id: apiToken.id }, data: { lastUsedAt: new Date() } })
        .catch((err) => console.error("Failed to update token usage", err));
    req.siteToken = {
        siteId: apiToken.siteId,
        tokenRole: apiToken.role,
    };
    next();
}
