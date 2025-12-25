"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminListPosts = adminListPosts;
exports.adminGetPost = adminGetPost;
exports.adminCreatePost = adminCreatePost;
exports.adminUpdatePost = adminUpdatePost;
exports.adminDeletePost = adminDeletePost;
exports.adminDashboard = adminDashboard;
exports.publishPost = publishPost;
exports.unpublishPost = unpublishPost;
exports.publicListPosts = publicListPosts;
exports.publicGetPostBySlug = publicGetPostBySlug;
const zod_1 = require("zod");
const slugify_1 = __importDefault(require("slugify"));
const prisma_1 = require("../config/prisma");
const client_1 = require("@prisma/client");
const createSchema = zod_1.z.object({
    title: zod_1.z.string().min(3),
    excerpt: zod_1.z.string().optional(),
    coverImageUrl: zod_1.z.string().optional(),
    contentHtml: zod_1.z.string().min(1),
    tags: zod_1.z.array(zod_1.z.string()).optional(), // tag names
});
const updateSchema = createSchema.partial();
async function ensureUniqueSlug(base, siteId) {
    let slug = (0, slugify_1.default)(base, { lower: true, strict: true });
    let i = 1;
    while (true) {
        const exists = await prisma_1.prisma.blogPost.findFirst({ where: { slug, siteId } });
        if (!exists)
            return slug;
        slug = `${(0, slugify_1.default)(base, { lower: true, strict: true })}-${i++}`;
    }
}
function canEditPost(auth, membershipRole, authorId) {
    if (auth.role === "SUPER_ADMIN")
        return true;
    if (membershipRole === client_1.SiteRole.OWNER)
        return true;
    if (membershipRole === client_1.SiteRole.EDITOR)
        return auth.adminId === authorId;
    return false;
}
function ensureCanMutateSite(auth, membershipRole) {
    if (auth.role === "SUPER_ADMIN" ||
        membershipRole === client_1.SiteRole.OWNER ||
        membershipRole === client_1.SiteRole.EDITOR) {
        return true;
    }
    return false;
}
async function adminListPosts(req, res) {
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    const posts = await prisma_1.prisma.blogPost.findMany({
        where: { siteId: site.siteId },
        orderBy: { updatedAt: "desc" },
        include: { author: { select: { id: true, name: true } }, tags: { include: { tag: true } } },
    });
    const enriched = posts.map((p) => ({
        ...p,
        isMine: p.authorId === auth.adminId,
        canEdit: canEditPost(auth, site.membershipRole, p.authorId),
    }));
    res.json({ posts: enriched });
}
async function adminGetPost(req, res) {
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    const post = await prisma_1.prisma.blogPost.findUnique({
        where: { id: req.params.id },
        include: { tags: { include: { tag: true } }, author: { select: { id: true, name: true } } },
    });
    if (!post || post.siteId !== site.siteId)
        return res.status(404).json({ message: "Not found" });
    res.json({ post: { ...post, canEdit: canEditPost(auth, site.membershipRole, post.authorId) } });
}
async function adminCreatePost(req, res) {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    if (!ensureCanMutateSite(auth, site.membershipRole)) {
        return res.status(403).json({ message: "You cannot create posts in this site" });
    }
    const slug = await ensureUniqueSlug(parsed.data.title, site.siteId);
    const post = await prisma_1.prisma.blogPost.create({
        data: {
            siteId: site.siteId,
            title: parsed.data.title,
            slug,
            excerpt: parsed.data.excerpt,
            coverImageUrl: parsed.data.coverImageUrl,
            contentHtml: parsed.data.contentHtml,
            authorId: auth.adminId,
        },
    });
    // tags
    if (parsed.data.tags?.length) {
        for (const t of parsed.data.tags) {
            const tagSlug = (0, slugify_1.default)(t, { lower: true, strict: true });
            const tag = await prisma_1.prisma.tag.upsert({
                where: { siteId_slug: { siteId: site.siteId, slug: tagSlug } },
                update: { name: t },
                create: { siteId: site.siteId, name: t, slug: tagSlug },
            });
            await prisma_1.prisma.blogPostTag.create({ data: { postId: post.id, tagId: tag.id } });
        }
    }
    res.status(201).json({ post });
}
async function adminUpdatePost(req, res) {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    const existing = await prisma_1.prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.siteId !== site.siteId)
        return res.status(404).json({ message: "Not found" });
    if (!canEditPost(auth, site.membershipRole, existing.authorId)) {
        return res.status(403).json({ message: "You can only edit your own posts" });
    }
    const post = await prisma_1.prisma.blogPost.update({
        where: { id: req.params.id },
        data: {
            title: parsed.data.title ?? undefined,
            excerpt: parsed.data.excerpt ?? undefined,
            coverImageUrl: parsed.data.coverImageUrl ?? undefined,
            contentHtml: parsed.data.contentHtml ?? undefined,
        },
    });
    // replace tags if provided
    if (parsed.data.tags) {
        await prisma_1.prisma.blogPostTag.deleteMany({ where: { postId: post.id } });
        for (const t of parsed.data.tags) {
            const tagSlug = (0, slugify_1.default)(t, { lower: true, strict: true });
            const tag = await prisma_1.prisma.tag.upsert({
                where: { siteId_slug: { siteId: site.siteId, slug: tagSlug } },
                update: { name: t },
                create: { siteId: site.siteId, name: t, slug: tagSlug },
            });
            await prisma_1.prisma.blogPostTag.create({ data: { postId: post.id, tagId: tag.id } });
        }
    }
    res.json({ post });
}
async function adminDeletePost(req, res) {
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    const existing = await prisma_1.prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.siteId !== site.siteId)
        return res.status(404).json({ message: "Not found" });
    if (!canEditPost(auth, site.membershipRole, existing.authorId)) {
        return res.status(403).json({ message: "You can only delete your own posts" });
    }
    await prisma_1.prisma.blogPost.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
}
async function adminDashboard(req, res) {
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    const [admin, totalPosts, myPosts, myPublished, myDrafts, teamPosts, myRecentPosts, teamRecentPosts, recentActivity,] = await Promise.all([
        prisma_1.prisma.adminUser.findUnique({
            where: { id: auth.adminId },
            select: { id: true, name: true, email: true, role: true, createdAt: true },
        }),
        prisma_1.prisma.blogPost.count({ where: { siteId: site.siteId } }),
        prisma_1.prisma.blogPost.count({ where: { authorId: auth.adminId, siteId: site.siteId } }),
        prisma_1.prisma.blogPost.count({
            where: { authorId: auth.adminId, status: "PUBLISHED", siteId: site.siteId },
        }),
        prisma_1.prisma.blogPost.count({
            where: { authorId: auth.adminId, status: "DRAFT", siteId: site.siteId },
        }),
        prisma_1.prisma.blogPost.count({ where: { authorId: { not: auth.adminId }, siteId: site.siteId } }),
        prisma_1.prisma.blogPost.findMany({
            where: { authorId: auth.adminId, siteId: site.siteId },
            orderBy: { updatedAt: "desc" },
            take: 5,
            select: {
                id: true,
                title: true,
                status: true,
                updatedAt: true,
                publishedAt: true,
                author: { select: { id: true, name: true } },
            },
        }),
        prisma_1.prisma.blogPost.findMany({
            where: { authorId: { not: auth.adminId }, siteId: site.siteId },
            orderBy: { updatedAt: "desc" },
            take: 5,
            select: {
                id: true,
                title: true,
                status: true,
                updatedAt: true,
                publishedAt: true,
                author: { select: { id: true, name: true } },
            },
        }),
        prisma_1.prisma.blogPost.findMany({
            where: { siteId: site.siteId },
            orderBy: { updatedAt: "desc" },
            take: 10,
            select: {
                id: true,
                title: true,
                status: true,
                updatedAt: true,
                authorId: true,
                author: { select: { id: true, name: true } },
            },
        }),
    ]);
    if (!admin)
        return res.status(404).json({ message: "Admin not found" });
    res.json({
        admin,
        stats: {
            totalPosts,
            myPosts,
            myPublished,
            myDrafts,
            teamPosts,
        },
        myRecentPosts: myRecentPosts.map((p) => ({ ...p, isMine: true })),
        teamRecentPosts: teamRecentPosts.map((p) => ({ ...p, isMine: false })),
        recentActivity: recentActivity.map((item) => ({
            ...item,
            isMine: item.authorId === auth.adminId,
        })),
    });
}
async function publishPost(req, res) {
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    const existing = await prisma_1.prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.siteId !== site.siteId)
        return res.status(404).json({ message: "Not found" });
    if (!canEditPost(auth, site.membershipRole, existing.authorId)) {
        return res.status(403).json({ message: "You can only publish your own posts" });
    }
    const post = await prisma_1.prisma.blogPost.update({
        where: { id: req.params.id },
        data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    res.json({ post });
}
async function unpublishPost(req, res) {
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    const existing = await prisma_1.prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.siteId !== site.siteId)
        return res.status(404).json({ message: "Not found" });
    if (!canEditPost(auth, site.membershipRole, existing.authorId)) {
        return res.status(403).json({ message: "You can only unpublish your own posts" });
    }
    const post = await prisma_1.prisma.blogPost.update({
        where: { id: req.params.id },
        data: { status: "DRAFT", publishedAt: null },
    });
    res.json({ post });
}
// PUBLIC
async function publicListPosts(req, res) {
    const siteToken = req.siteToken;
    if (!siteToken)
        return res.status(401).json({ message: "Missing site token" });
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
    const search = String(req.query.search || "").trim();
    const tag = String(req.query.tag || "").trim();
    const where = {
        siteId: siteToken.siteId,
        status: "PUBLISHED",
    };
    if (search) {
        where.OR = [
            { title: { contains: search, mode: "insensitive" } },
            { excerpt: { contains: search, mode: "insensitive" } },
        ];
    }
    if (tag) {
        where.tags = {
            some: { tag: { slug: tag } },
        };
    }
    const [total, posts] = await Promise.all([
        prisma_1.prisma.blogPost.count({ where }),
        prisma_1.prisma.blogPost.findMany({
            where,
            orderBy: { publishedAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id: true,
                title: true,
                slug: true,
                excerpt: true,
                coverImageUrl: true,
                publishedAt: true,
                tags: { select: { tag: { select: { name: true, slug: true } } } },
            },
        }),
    ]);
    res.json({ page, limit, total, posts });
}
async function publicGetPostBySlug(req, res) {
    const siteToken = req.siteToken;
    if (!siteToken)
        return res.status(401).json({ message: "Missing site token" });
    const post = await prisma_1.prisma.blogPost.findFirst({
        where: { slug: req.params.slug, status: "PUBLISHED", siteId: siteToken.siteId },
        select: {
            id: true,
            title: true,
            slug: true,
            excerpt: true,
            coverImageUrl: true,
            contentHtml: true,
            publishedAt: true,
            tags: { select: { tag: { select: { name: true, slug: true } } } },
        },
    });
    if (!post)
        return res.status(404).json({ message: "Not found" });
    res.json({ post });
}
