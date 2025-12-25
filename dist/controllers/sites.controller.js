"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listSites = listSites;
exports.createSite = createSite;
exports.listTokens = listTokens;
exports.createToken = createToken;
exports.deleteToken = deleteToken;
exports.listDomains = listDomains;
exports.addDomain = addDomain;
exports.refreshDomainToken = refreshDomainToken;
exports.verifyDomain = verifyDomain;
const zod_1 = require("zod");
const slugify_1 = __importDefault(require("slugify"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../config/prisma");
const client_1 = require("@prisma/client");
const promises_1 = __importDefault(require("dns/promises"));
const createSiteSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    domains: zod_1.z.array(zod_1.z.string()).optional(),
    defaultLocale: zod_1.z.string().optional(),
    settingsJson: zod_1.z.record(zod_1.z.string(), zod_1.z.any()).optional(),
});
const createTokenSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    role: zod_1.z.nativeEnum(client_1.ApiTokenRole).optional().default(client_1.ApiTokenRole.READ_ONLY),
    expiresAt: zod_1.z.string().optional(),
});
const addDomainSchema = zod_1.z.object({
    domain: zod_1.z.string().min(3),
});
async function ensureUniqueSiteSlug(base) {
    let slug = (0, slugify_1.default)(base, { lower: true, strict: true });
    let i = 1;
    while (true) {
        const exists = await prisma_1.prisma.site.findUnique({ where: { slug } });
        if (!exists)
            return slug;
        slug = `${(0, slugify_1.default)(base, { lower: true, strict: true })}-${i++}`;
    }
}
function hashToken(token) {
    return crypto_1.default.createHash("sha256").update(token).digest("hex");
}
function generatePlainToken() {
    return crypto_1.default.randomBytes(32).toString("hex");
}
async function listSites(req, res) {
    const auth = req.auth;
    const memberships = await prisma_1.prisma.adminSiteMembership.findMany({
        where: { adminId: auth.adminId },
        include: { site: { include: { siteDomains: true } } },
    });
    const memberSites = memberships.map((m) => ({
        ...m.site,
        siteDomains: m.site.siteDomains,
        membershipRole: m.role,
    }));
    if (auth.role === "SUPER_ADMIN") {
        const allSites = await prisma_1.prisma.site.findMany({ include: { siteDomains: true } });
        const merged = new Map();
        for (const site of [
            ...memberSites,
            ...allSites.map((s) => ({ ...s, membershipRole: client_1.SiteRole.OWNER })),
        ]) {
            merged.set(site.id, site);
        }
        return res.json({ sites: Array.from(merged.values()) });
    }
    return res.json({ sites: memberSites });
}
async function createSite(req, res) {
    const auth = req.auth;
    const parsed = createSiteSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const slug = await ensureUniqueSiteSlug(parsed.data.name);
    const site = await prisma_1.prisma.site.create({
        data: {
            name: parsed.data.name,
            slug,
            domains: parsed.data.domains ?? [],
            defaultLocale: parsed.data.defaultLocale,
            settingsJson: parsed.data.settingsJson === undefined ? undefined : parsed.data.settingsJson,
        },
    });
    await prisma_1.prisma.adminSiteMembership.create({
        data: { adminId: auth.adminId, siteId: site.id, role: client_1.SiteRole.OWNER },
    });
    res.status(201).json({ site: { ...site, membershipRole: client_1.SiteRole.OWNER } });
}
async function listTokens(req, res) {
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== client_1.SiteRole.OWNER) {
        return res.status(403).json({ message: "Only owners can view tokens" });
    }
    const tokens = await prisma_1.prisma.apiToken.findMany({
        where: { siteId: site.siteId },
        select: {
            id: true,
            name: true,
            role: true,
            expiresAt: true,
            lastUsedAt: true,
            createdAt: true,
        },
        orderBy: { createdAt: "desc" },
    });
    res.json({ tokens });
}
async function createToken(req, res) {
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== client_1.SiteRole.OWNER) {
        return res.status(403).json({ message: "Only owners can create tokens" });
    }
    const parsed = createTokenSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const plain = generatePlainToken();
    const hashed = hashToken(plain);
    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    const token = await prisma_1.prisma.apiToken.create({
        data: {
            siteId: site.siteId,
            name: parsed.data.name,
            role: parsed.data.role ?? client_1.ApiTokenRole.READ_ONLY,
            expiresAt,
            hashed,
        },
        select: {
            id: true,
            name: true,
            role: true,
            expiresAt: true,
            lastUsedAt: true,
            createdAt: true,
        },
    });
    res.status(201).json({ token, plainToken: plain });
}
async function deleteToken(req, res) {
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== client_1.SiteRole.OWNER) {
        return res.status(403).json({ message: "Only owners can delete tokens" });
    }
    const token = await prisma_1.prisma.apiToken.findUnique({ where: { id: req.params.tokenId } });
    if (!token || token.siteId !== site.siteId)
        return res.status(404).json({ message: "Not found" });
    await prisma_1.prisma.apiToken.delete({ where: { id: token.id } });
    res.json({ ok: true });
}
function normalizeDomain(domain) {
    return domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}
function generateDomainToken() {
    return crypto_1.default.randomBytes(16).toString("hex");
}
async function listDomains(req, res) {
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    const domains = await prisma_1.prisma.siteDomain.findMany({
        where: { siteId: site.siteId },
        orderBy: { createdAt: "desc" },
    });
    res.json({ domains });
}
async function addDomain(req, res) {
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== client_1.SiteRole.OWNER) {
        return res.status(403).json({ message: "Only owners can manage domains" });
    }
    const parsed = addDomainSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const domain = normalizeDomain(parsed.data.domain);
    const token = generateDomainToken();
    const record = await prisma_1.prisma.siteDomain.upsert({
        where: { siteId_domain: { siteId: site.siteId, domain } },
        update: { verificationToken: token, status: "PENDING" },
        create: {
            siteId: site.siteId,
            domain,
            verificationToken: token,
            status: "PENDING",
        },
    });
    // keep domains array in sync for backwards compatibility
    await prisma_1.prisma.site.update({
        where: { id: site.siteId },
        data: {
            domains: {
                push: domain,
            },
        },
    }).catch(() => {
        /* ignore array sync errors */
    });
    res.status(201).json({ domain: record });
}
async function refreshDomainToken(req, res) {
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== client_1.SiteRole.OWNER) {
        return res.status(403).json({ message: "Only owners can manage domains" });
    }
    const domain = await prisma_1.prisma.siteDomain.findUnique({ where: { id: req.params.domainId } });
    if (!domain || domain.siteId !== site.siteId)
        return res.status(404).json({ message: "Not found" });
    const updated = await prisma_1.prisma.siteDomain.update({
        where: { id: domain.id },
        data: { verificationToken: generateDomainToken(), status: "PENDING", verifiedAt: null },
    });
    res.json({ domain: updated });
}
async function verifyDomain(req, res) {
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== client_1.SiteRole.OWNER) {
        return res.status(403).json({ message: "Only owners can verify domains" });
    }
    const domain = await prisma_1.prisma.siteDomain.findUnique({ where: { id: req.params.domainId } });
    if (!domain || domain.siteId !== site.siteId)
        return res.status(404).json({ message: "Not found" });
    // DNS TXT check: sapphire-site-verification=<token>
    try {
        const txtRecords = await promises_1.default.resolveTxt(domain.domain);
        const flat = txtRecords.flat().map((t) => t.toString());
        const match = flat.some((entry) => entry.includes(domain.verificationToken));
        if (!match) {
            await prisma_1.prisma.siteDomain.update({
                where: { id: domain.id },
                data: { status: "FAILED" },
            });
            return res.status(400).json({
                message: "Verification token not found in DNS TXT records",
                expected: `TXT sapphire-site-verification=${domain.verificationToken}`,
            });
        }
    }
    catch (err) {
        await prisma_1.prisma.siteDomain.update({
            where: { id: domain.id },
            data: { status: "FAILED" },
        });
        return res.status(400).json({ message: "DNS lookup failed", detail: err?.message });
    }
    const updated = await prisma_1.prisma.siteDomain.update({
        where: { id: domain.id },
        data: { status: "VERIFIED", verifiedAt: new Date() },
    });
    res.json({ domain: updated });
}
