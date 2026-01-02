"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.verifyDomainHtml = verifyDomainHtml;
exports.deleteDomain = deleteDomain;
exports.deleteSite = deleteSite;
exports.makePrimarySite = makePrimarySite;
const zod_1 = require("zod");
const slugify_1 = __importDefault(require("slugify"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../config/prisma");
const client_1 = require("@prisma/client");
const promises_1 = __importDefault(require("dns/promises"));
const axios_1 = __importDefault(require("axios"));
const accountSubscription_1 = require("../utils/accountSubscription");
const plans_1 = require("../config/plans");
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
    const accountSub = await (0, accountSubscription_1.getAccountSubscription)(auth.adminId);
    const memberSites = memberships.map((m) => ({
        ...m.site,
        siteDomains: m.site.siteDomains,
        subscription: accountSub
            ? {
                plan: accountSub.plan,
                status: accountSub.status,
                expiresAt: accountSub.expiresAt,
                startedAt: accountSub.startedAt,
            }
            : {
                plan: "FREE",
                status: "active",
                expiresAt: null,
                startedAt: null,
            },
        membershipRole: m.role,
    }));
    if (auth.role === "SUPER_ADMIN") {
        const allSites = await prisma_1.prisma.site.findMany({ include: { siteDomains: true } });
        const merged = new Map();
        for (const site of [
            ...memberSites,
            ...allSites.map((s) => ({
                ...s,
                subscription: accountSub
                    ? {
                        plan: accountSub.plan,
                        status: accountSub.status,
                        expiresAt: accountSub.expiresAt,
                        startedAt: accountSub.startedAt,
                    }
                    : {
                        plan: "FREE",
                        status: "active",
                        expiresAt: null,
                        startedAt: null,
                    },
                membershipRole: client_1.SiteRole.OWNER,
            })),
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
    if (auth.role !== "SUPER_ADMIN") {
        const plan = await (0, accountSubscription_1.getAccountPlan)(auth.adminId);
        const siteLimit = (0, plans_1.getSiteLimit)(plan);
        if (siteLimit !== null) {
            const siteCount = await prisma_1.prisma.adminSiteMembership.count({
                where: { adminId: auth.adminId },
            });
            if (siteCount >= siteLimit) {
                return res.status(402).json({
                    message: "Site limit reached. Upgrade to add more sites.",
                    plans: plans_1.PLANS.filter((p) => p.id !== "FREE"),
                });
            }
        }
    }
    const firstDomain = parsed.data.domains && parsed.data.domains.length > 0
        ? normalizeDomain(parsed.data.domains[0])
        : undefined;
    const slug = await ensureUniqueSiteSlug(parsed.data.name);
    const site = await prisma_1.prisma.site.create({
        data: {
            name: parsed.data.name,
            slug,
            domains: firstDomain ? [firstDomain] : [],
            defaultLocale: parsed.data.defaultLocale,
            settingsJson: parsed.data.settingsJson === undefined ? undefined : parsed.data.settingsJson,
        },
    });
    await prisma_1.prisma.adminSiteMembership.create({
        data: { adminId: auth.adminId, siteId: site.id, role: client_1.SiteRole.OWNER },
    });
    const adminRecord = await prisma_1.prisma.adminUser.findUnique({
        where: { id: auth.adminId },
        select: { primarySiteId: true },
    });
    if (!adminRecord?.primarySiteId) {
        await prisma_1.prisma.adminUser.update({ where: { id: auth.adminId }, data: { primarySiteId: site.id } });
    }
    // Create a domain record immediately if provided (single primary domain per site)
    if (firstDomain) {
        await prisma_1.prisma.siteDomain.create({
            data: {
                siteId: site.id,
                domain: firstDomain,
                verificationToken: generateDomainToken(),
                status: "PENDING",
            },
        });
    }
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
            plain: true,
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
    const existingToken = await prisma_1.prisma.apiToken.findFirst({
        where: { siteId: site.siteId },
    });
    if (existingToken) {
        return res
            .status(400)
            .json({ message: "This site already has a token. Delete the existing token to create a new one." });
    }
    const plain = generatePlainToken();
    const hashed = hashToken(plain);
    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    const token = await prisma_1.prisma.apiToken.create({
        data: {
            siteId: site.siteId,
            name: parsed.data.name,
            plain: plain,
            role: parsed.data.role ?? client_1.ApiTokenRole.READ_ONLY,
            expiresAt,
            hashed,
        },
        select: {
            id: true,
            name: true,
            plain: true,
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
    // Enforce single primary domain per site
    const existingDomain = await prisma_1.prisma.siteDomain.findFirst({ where: { siteId: site.siteId } });
    if (existingDomain && existingDomain.domain !== domain) {
        return res.status(400).json({ message: "A site can have only one domain. Delete the current domain first." });
    }
    // Keep the same token once generated for this domain until it is deleted.
    const existing = await prisma_1.prisma.siteDomain.findUnique({
        where: { siteId_domain: { siteId: site.siteId, domain } },
    });
    const record = existing ??
        (await prisma_1.prisma.siteDomain.create({
            data: {
                siteId: site.siteId,
                domain,
                verificationToken: generateDomainToken(),
                status: "PENDING",
            },
        }));
    // keep domains array in sync for backwards compatibility
    await prisma_1.prisma.site
        .update({
        where: { id: site.siteId },
        data: {
            domains: [domain],
        },
    })
        .catch(() => {
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
    // Tokens stay fixed per domain; do not rotate. Return current record.
    res.json({ domain });
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
    // Allow this domain (and its subdomains) via CORS without manual env edits
    try {
        const { addVerifiedDomain } = await Promise.resolve().then(() => __importStar(require("../config/cors")));
        addVerifiedDomain(domain.domain);
    }
    catch (err) {
        console.error("Failed to add verified domain to CORS allowlist", err);
    }
    res.json({ domain: updated });
}
// HTML file verification fallback: expects a file at
// https://<domain>/.well-known/sapphire-site-verification.txt
// containing the verification token.
async function verifyDomainHtml(req, res) {
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
    const urls = [
        `https://${domain.domain}/.well-known/sapphire-site-verification.txt`,
        `http://${domain.domain}/.well-known/sapphire-site-verification.txt`,
    ];
    let matched = false;
    let lastError = null;
    for (const url of urls) {
        try {
            const resp = await axios_1.default.get(url, { timeout: 5000 });
            const body = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
            if (body.includes(domain.verificationToken)) {
                matched = true;
                break;
            }
            lastError = `Token not found at ${url}`;
        }
        catch (err) {
            lastError = err?.message || `Request failed for ${url}`;
        }
    }
    if (!matched) {
        await prisma_1.prisma.siteDomain.update({
            where: { id: domain.id },
            data: { status: "FAILED" },
        });
        return res.status(400).json({
            message: lastError || "Verification token not found in HTML file",
            expectedPath: "/.well-known/sapphire-site-verification.txt",
            expectedContent: domain.verificationToken,
        });
    }
    const updated = await prisma_1.prisma.siteDomain.update({
        where: { id: domain.id },
        data: { status: "VERIFIED", verifiedAt: new Date() },
    });
    // Allow this domain (and its subdomains) via CORS without manual env edits
    try {
        const { addVerifiedDomain } = await Promise.resolve().then(() => __importStar(require("../config/cors")));
        addVerifiedDomain(domain.domain);
    }
    catch (err) {
        console.error("Failed to add verified domain to CORS allowlist", err);
    }
    res.json({ domain: updated });
}
async function deleteDomain(req, res) {
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
    // Sync domains array by removing the deleted domain
    const siteRecord = await prisma_1.prisma.site.findUnique({
        where: { id: site.siteId },
        select: { domains: true },
    });
    const currentDomains = siteRecord?.domains ?? [];
    const filteredDomains = currentDomains.filter((d) => d !== domain.domain);
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.siteDomain.delete({ where: { id: domain.id } }),
        prisma_1.prisma.site.update({
            where: { id: site.siteId },
            data: { domains: filteredDomains },
        }),
    ]);
    return res.json({ ok: true });
}
async function deleteSite(req, res) {
    const auth = req.auth;
    const siteId = req.params.id;
    if (!siteId)
        return res.status(400).json({ message: "Missing site id" });
    const membership = await prisma_1.prisma.adminSiteMembership.findFirst({
        where: { siteId, adminId: auth.adminId },
    });
    const isSuperAdmin = auth.role === "SUPER_ADMIN";
    if (!membership && !isSuperAdmin) {
        return res.status(403).json({ message: "You do not have access to this site" });
    }
    if (!isSuperAdmin && membership?.role !== client_1.SiteRole.OWNER) {
        return res.status(403).json({ message: "Only owners can delete a site" });
    }
    const adminRecord = await prisma_1.prisma.adminUser.findUnique({
        where: { id: auth.adminId },
        select: { primarySiteId: true },
    });
    if (adminRecord?.primarySiteId === siteId) {
        const otherSites = await prisma_1.prisma.adminSiteMembership.count({
            where: { adminId: auth.adminId, siteId: { not: siteId } },
        });
        if (otherSites > 0) {
            return res.status(400).json({ message: "This is your primary site. Set another site as primary before deleting." });
        }
        return res.status(400).json({ message: "You cannot delete your only site." });
    }
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.blogPostTag.deleteMany({ where: { post: { siteId } } }),
        prisma_1.prisma.blogPost.deleteMany({ where: { siteId } }),
        prisma_1.prisma.tag.deleteMany({ where: { siteId } }),
        prisma_1.prisma.apiToken.deleteMany({ where: { siteId } }),
        prisma_1.prisma.siteDomain.deleteMany({ where: { siteId } }),
        prisma_1.prisma.adminSiteMembership.deleteMany({ where: { siteId } }),
        prisma_1.prisma.site.delete({ where: { id: siteId } }),
    ]);
    return res.json({ ok: true });
}
async function makePrimarySite(req, res) {
    const auth = req.auth;
    const siteId = req.params.id;
    if (!siteId)
        return res.status(400).json({ message: "Missing site id" });
    const membership = await prisma_1.prisma.adminSiteMembership.findFirst({
        where: { adminId: auth.adminId, siteId },
    });
    const isSuperAdmin = auth.role === "SUPER_ADMIN";
    if (!membership && !isSuperAdmin)
        return res.status(403).json({ message: "You do not have access to this site" });
    if (!isSuperAdmin && membership?.role !== client_1.SiteRole.OWNER) {
        return res.status(403).json({ message: "Only owners can set a primary site" });
    }
    await prisma_1.prisma.adminUser.update({ where: { id: auth.adminId }, data: { primarySiteId: siteId } });
    return res.json({ ok: true, primarySiteId: siteId });
}
