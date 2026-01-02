"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDefaultSite = ensureDefaultSite;
const slugify_1 = __importDefault(require("slugify"));
const prisma_1 = require("../config/prisma");
const client_1 = require("@prisma/client");
const accountSubscription_1 = require("./accountSubscription");
async function ensureDefaultSite(adminId, adminName) {
    const existingSite = await prisma_1.prisma.adminSiteMembership.findFirst({ where: { adminId } });
    if (existingSite) {
        const admin = await prisma_1.prisma.adminUser.findUnique({
            where: { id: adminId },
            select: { primarySiteId: true },
        });
        if (!admin?.primarySiteId) {
            await prisma_1.prisma.adminUser.update({ where: { id: adminId }, data: { primarySiteId: existingSite.siteId } });
        }
        await (0, accountSubscription_1.ensureAccountSubscription)(adminId);
        return;
    }
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
    await prisma_1.prisma.adminUser.update({ where: { id: adminId }, data: { primarySiteId: site.id } });
    await (0, accountSubscription_1.ensureAccountSubscription)(adminId);
}
