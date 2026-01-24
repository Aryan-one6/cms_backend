"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSuperAdmin = requireSuperAdmin;
exports.listUsers = listUsers;
exports.createUser = createUser;
exports.updateUser = updateUser;
exports.deleteUser = deleteUser;
exports.listSites = listSites;
exports.updateSiteStatus = updateSiteStatus;
exports.deleteSiteSuper = deleteSiteSuper;
exports.listPosts = listPosts;
exports.deletePostSuper = deletePostSuper;
exports.listSubscriptions = listSubscriptions;
exports.getMetrics = getMetrics;
exports.listCouponsSuper = listCouponsSuper;
exports.createCouponSuper = createCouponSuper;
exports.updateCouponSuper = updateCouponSuper;
exports.deleteCouponSuper = deleteCouponSuper;
const prisma_1 = require("../config/prisma");
const bcrypt_1 = __importDefault(require("bcrypt"));
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const plans_1 = require("../config/plans");
const couponStore_1 = require("../utils/couponStore");
function requireSuperAdmin(req, res, next) {
    const auth = req.auth;
    if (!auth || auth.role !== "SUPER_ADMIN") {
        return res.status(403).json({ message: "Super admin access required" });
    }
    next();
}
const createUserSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
    role: zod_1.z.nativeEnum(client_1.AdminRole).optional().default(client_1.AdminRole.EDITOR),
});
const updateUserSchema = zod_1.z.object({
    role: zod_1.z.nativeEnum(client_1.AdminRole).optional(),
    status: zod_1.z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});
const updateSiteStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(["ACTIVE", "SUSPENDED"]),
});
const couponSchema = zod_1.z.object({
    code: zod_1.z.string().min(2).max(40),
    amountOffPaise: zod_1.z.number().int().nonnegative().optional(),
    percentOff: zod_1.z.number().min(1).max(100).optional(),
    maxRedemptions: zod_1.z.number().int().positive().optional(),
    expiresAt: zod_1.z.string().datetime().optional(),
    validFrom: zod_1.z.string().datetime().optional(),
    applicablePlans: zod_1.z.array(zod_1.z.nativeEnum(client_1.Plan)).nonempty().optional(),
    minOrderPaise: zod_1.z.number().int().nonnegative().optional(),
    minMonths: zod_1.z.number().int().nonnegative().optional(),
    notes: zod_1.z.string().max(200).optional(),
    active: zod_1.z.boolean().optional().default(true),
});
function priceForPlan(plan) {
    const entry = plans_1.PLANS.find((p) => p.plan === plan);
    return entry?.pricePaise ?? 0;
}
async function listUsers(_req, res) {
    const users = await prisma_1.prisma.adminUser.findMany({
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
            createdAt: true,
            avatarUrl: true,
            oauthProvider: true,
            oauthSubject: true,
            _count: { select: { memberships: true, posts: true } },
        },
    });
    res.json({ users });
}
async function createUser(req, res) {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const exists = await prisma_1.prisma.adminUser.findUnique({ where: { email: parsed.data.email } });
    if (exists)
        return res.status(400).json({ message: "Email already exists" });
    const passwordHash = await bcrypt_1.default.hash(parsed.data.password, 10);
    const user = await prisma_1.prisma.adminUser.create({
        data: {
            name: parsed.data.name,
            email: parsed.data.email,
            passwordHash,
            role: parsed.data.role,
            status: "ACTIVE",
        },
    });
    res.status(201).json({ user });
}
async function updateUser(req, res) {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const user = await prisma_1.prisma.adminUser.findUnique({ where: { id: req.params.userId } });
    if (!user)
        return res.status(404).json({ message: "User not found" });
    if (user.role === "SUPER_ADMIN")
        return res.status(400).json({ message: "Super admin cannot be modified" });
    const updated = await prisma_1.prisma.adminUser.update({
        where: { id: user.id },
        data: {
            ...(parsed.data.role ? { role: parsed.data.role } : {}),
            ...(parsed.data.status ? { status: parsed.data.status } : {}),
        },
    });
    res.json({ user: updated });
}
async function deleteUser(req, res) {
    const self = req.auth;
    if (self?.adminId === req.params.userId) {
        return res.status(400).json({ message: "You cannot delete your own account" });
    }
    const user = await prisma_1.prisma.adminUser.findUnique({ where: { id: req.params.userId } });
    if (!user)
        return res.status(404).json({ message: "User not found" });
    if (user.role === "SUPER_ADMIN")
        return res.status(400).json({ message: "Super admin cannot be deleted" });
    const posts = await prisma_1.prisma.blogPost.findMany({ where: { authorId: user.id }, select: { id: true } });
    const postIds = posts.map((p) => p.id);
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.blogPostTag.deleteMany({ where: { postId: { in: postIds } } }),
        prisma_1.prisma.blogPost.deleteMany({ where: { id: { in: postIds } } }),
        prisma_1.prisma.adminSiteMembership.deleteMany({ where: { adminId: user.id } }),
        prisma_1.prisma.accountSubscription.deleteMany({ where: { adminId: user.id } }),
        prisma_1.prisma.adminUser.delete({ where: { id: user.id } }),
    ]);
    // Cleanup orphaned sites (no memberships left)
    const orphanSites = await prisma_1.prisma.site.findMany({
        where: { memberships: { none: {} } },
        select: { id: true },
    });
    if (orphanSites.length) {
        const ids = orphanSites.map((s) => s.id);
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.blogPostTag.deleteMany({ where: { post: { siteId: { in: ids } } } }),
            prisma_1.prisma.blogPost.deleteMany({ where: { siteId: { in: ids } } }),
            prisma_1.prisma.tag.deleteMany({ where: { siteId: { in: ids } } }),
            prisma_1.prisma.apiToken.deleteMany({ where: { siteId: { in: ids } } }),
            prisma_1.prisma.siteDomain.deleteMany({ where: { siteId: { in: ids } } }),
            prisma_1.prisma.site.deleteMany({ where: { id: { in: ids } } }),
        ]);
    }
    res.json({ ok: true });
}
async function listSites(_req, res) {
    const sites = await prisma_1.prisma.site.findMany({
        orderBy: { createdAt: "desc" },
        where: { memberships: { some: {} } }, // hide sites with no members
        include: {
            siteDomains: true,
            memberships: { include: { admin: { select: { id: true, name: true, email: true, role: true } } } },
            _count: {
                select: { posts: true, apiTokens: true, memberships: true },
            },
        },
    });
    res.json({ sites });
}
async function updateSiteStatus(req, res) {
    const parsed = updateSiteStatusSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const site = await prisma_1.prisma.site.findUnique({ where: { id: req.params.siteId } });
    if (!site)
        return res.status(404).json({ message: "Site not found" });
    const updated = await prisma_1.prisma.site.update({
        where: { id: site.id },
        data: { status: parsed.data.status },
    });
    res.json({ site: updated });
}
async function deleteSiteSuper(req, res) {
    const siteId = req.params.siteId;
    if (!siteId)
        return res.status(400).json({ message: "Missing site id" });
    const site = await prisma_1.prisma.site.findUnique({ where: { id: siteId } });
    if (!site)
        return res.status(404).json({ message: "Site not found" });
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.blogPostTag.deleteMany({ where: { post: { siteId } } }),
        prisma_1.prisma.blogPost.deleteMany({ where: { siteId } }),
        prisma_1.prisma.tag.deleteMany({ where: { siteId } }),
        prisma_1.prisma.apiToken.deleteMany({ where: { siteId } }),
        prisma_1.prisma.siteDomain.deleteMany({ where: { siteId } }),
        prisma_1.prisma.adminSiteMembership.deleteMany({ where: { siteId } }),
        prisma_1.prisma.site.delete({ where: { id: siteId } }),
    ]);
    res.json({ ok: true });
}
async function listPosts(_req, res) {
    const posts = await prisma_1.prisma.blogPost.findMany({
        orderBy: { createdAt: "desc" },
        include: {
            site: { select: { id: true, name: true } },
            author: { select: { id: true, name: true, email: true } },
        },
    });
    res.json({ posts });
}
async function deletePostSuper(req, res) {
    const post = await prisma_1.prisma.blogPost.findUnique({ where: { id: req.params.postId } });
    if (!post)
        return res.status(404).json({ message: "Post not found" });
    await prisma_1.prisma.blogPostTag.deleteMany({ where: { postId: post.id } });
    await prisma_1.prisma.blogPost.delete({ where: { id: post.id } });
    res.json({ ok: true });
}
async function listSubscriptions(_req, res) {
    const subs = await prisma_1.prisma.accountSubscription.findMany({
        orderBy: { createdAt: "desc" },
        include: { admin: { select: { id: true, name: true, email: true } } },
    });
    res.json({ subscriptions: subs });
}
async function getMetrics(_req, res) {
    const [users, sites, posts, subs] = await Promise.all([
        prisma_1.prisma.adminUser.count({ where: { role: { not: "SUPER_ADMIN" } } }),
        prisma_1.prisma.site.count(),
        prisma_1.prisma.blogPost.count(),
        prisma_1.prisma.accountSubscription.findMany({ where: { status: "active" } }),
    ]);
    const revenuePaise = subs.reduce((sum, s) => sum + priceForPlan(s.plan), 0);
    res.json({
        metrics: {
            users,
            sites,
            posts,
            activeSubscriptions: subs.length,
            revenuePaise,
        },
    });
}
async function listCouponsSuper(_req, res) {
    const defaults = [
        {
            id: "DEFAULT_FREE100",
            code: "FREE100",
            amountOffPaise: 0,
            percentOff: 100,
            maxRedemptions: null,
            redeemed: undefined,
            expiresAt: null,
            notes: "Built-in code: activates selected plan for free",
            active: true,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            readOnly: true,
        },
        {
            id: "DEFAULT_ONEINR",
            code: "ONEINR",
            amountOffPaise: undefined,
            percentOff: undefined,
            maxRedemptions: null,
            redeemed: undefined,
            expiresAt: null,
            notes: "Built-in code: sets total to ₹1 before taxes",
            active: true,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            readOnly: true,
        },
    ];
    const coupons = await (0, couponStore_1.listCoupons)();
    const merged = [...defaults, ...coupons.filter((c) => !defaults.find((d) => d.code === c.code))];
    res.json({ coupons: merged });
}
async function createCouponSuper(req, res) {
    const parsed = couponSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    if (!parsed.data.amountOffPaise && !parsed.data.percentOff) {
        return res.status(400).json({ message: "Provide amountOffPaise or percentOff" });
    }
    const exists = await (0, couponStore_1.findCouponByCode)(parsed.data.code.toUpperCase());
    if (exists)
        return res.status(400).json({ message: "Coupon code already exists" });
    const coupon = await (0, couponStore_1.createCoupon)({
        ...parsed.data,
        redeemed: 0,
    });
    res.status(201).json({ coupon });
}
async function updateCouponSuper(req, res) {
    const parsed = couponSchema.partial().safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const existing = await (0, couponStore_1.findCouponById)(req.params.id);
    if (!existing)
        return res.status(404).json({ message: "Coupon not found" });
    if (existing.readOnly)
        return res.status(400).json({ message: "This coupon is read-only" });
    const updated = await (0, couponStore_1.updateCoupon)(req.params.id, parsed.data);
    res.json({ coupon: updated });
}
async function deleteCouponSuper(req, res) {
    const existing = await (0, couponStore_1.findCouponById)(req.params.id);
    if (!existing)
        return res.status(404).json({ message: "Coupon not found" });
    if (existing.readOnly)
        return res.status(400).json({ message: "This coupon is read-only" });
    await (0, couponStore_1.deleteCoupon)(req.params.id);
    res.json({ ok: true });
}
