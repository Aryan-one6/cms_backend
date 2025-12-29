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
const prisma_1 = require("../config/prisma");
const bcrypt_1 = __importDefault(require("bcrypt"));
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
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
async function listUsers(_req, res) {
    const users = await prisma_1.prisma.adminUser.findMany({
        orderBy: { createdAt: "desc" },
        include: {
            _count: {
                select: { memberships: true, posts: true },
            },
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
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.adminSiteMembership.deleteMany({ where: { adminId: user.id } }),
        prisma_1.prisma.blogPost.deleteMany({ where: { authorId: user.id } }),
        prisma_1.prisma.adminUser.delete({ where: { id: user.id } }),
    ]);
    res.json({ ok: true });
}
async function listSites(_req, res) {
    const sites = await prisma_1.prisma.site.findMany({
        orderBy: { createdAt: "desc" },
        include: {
            siteDomains: true,
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
