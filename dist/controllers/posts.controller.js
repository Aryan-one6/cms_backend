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
exports.adminExportPosts = adminExportPosts;
exports.adminImportPosts = adminImportPosts;
exports.adminDashboard = adminDashboard;
exports.publishPost = publishPost;
exports.unpublishPost = unpublishPost;
exports.publicListPosts = publicListPosts;
exports.publicGetPostBySlug = publicGetPostBySlug;
const zod_1 = require("zod");
const slugify_1 = __importDefault(require("slugify"));
const prisma_1 = require("../config/prisma");
const client_1 = require("@prisma/client");
const plans_1 = require("../config/plans");
const accountSubscription_1 = require("../utils/accountSubscription");
const createSchema = zod_1.z.object({
    title: zod_1.z.string().min(3),
    slug: zod_1.z.string().optional(),
    excerpt: zod_1.z.string().optional(),
    coverImageUrl: zod_1.z.string().optional(),
    contentHtml: zod_1.z.string().min(1),
    tags: zod_1.z.array(zod_1.z.string()).optional(), // tag names
});
const updateSchema = createSchema.partial();
const importPostSchema = zod_1.z.object({
    title: zod_1.z.string().min(3),
    slug: zod_1.z.string().optional(),
    excerpt: zod_1.z.string().optional(),
    coverImageUrl: zod_1.z.string().optional(),
    coverImageAbsolute: zod_1.z.string().optional(),
    contentHtml: zod_1.z.string().min(1),
    tags: zod_1.z.array(zod_1.z.string()).optional(),
    status: zod_1.z.enum(["DRAFT", "PUBLISHED"]).optional(),
    publishedAt: zod_1.z.string().datetime().optional(),
});
const importSchema = zod_1.z.object({
    posts: zod_1.z.array(importPostSchema).min(1, "No posts provided"),
});
function stringifyCsvField(value) {
    const str = value == null ? "" : String(value);
    if (/[",\n]/.test(str))
        return `"${str.replace(/"/g, '""')}"`;
    return str;
}
function postsToCsv(rows) {
    const headers = [
        "title",
        "slug",
        "excerpt",
        "coverImageUrl",
        "contentHtml",
        "tags",
        "status",
        "publishedAt",
    ];
    const lines = [
        headers.join(","),
        ...rows.map((row) => headers
            .map((h) => {
            if (h === "tags" && Array.isArray(row.tags))
                return stringifyCsvField(row.tags.join("|"));
            return stringifyCsvField(row[h]);
        })
            .join(",")),
    ];
    return lines.join("\n");
}
function parseCsvPosts(csvText) {
    const rows = [];
    let current = "";
    let field = [];
    let inQuotes = false;
    const pushField = () => {
        field.push(current.replace(/""/g, '"'));
        current = "";
    };
    const pushRow = () => {
        rows.push(field);
        field = [];
    };
    for (let i = 0; i < csvText.length; i++) {
        const ch = csvText[i];
        if (ch === '"') {
            if (inQuotes && csvText[i + 1] === '"') {
                current += '"';
                i++;
            }
            else {
                inQuotes = !inQuotes;
            }
        }
        else if (ch === "," && !inQuotes) {
            pushField();
        }
        else if ((ch === "\n" || ch === "\r") && !inQuotes) {
            if (ch === "\r" && csvText[i + 1] === "\n")
                i++;
            pushField();
            pushRow();
        }
        else {
            current += ch;
        }
    }
    pushField();
    pushRow();
    const [headerRow, ...dataRows] = rows.filter((r) => r.length && r.some((c) => c.trim().length));
    if (!headerRow)
        return [];
    const headers = headerRow.map((h) => h.trim().toLowerCase());
    return dataRows
        .map((cols) => {
        const obj = {};
        headers.forEach((h, idx) => {
            const val = cols[idx] ?? "";
            obj[h] = val.trim();
        });
        return obj;
    })
        .filter((o) => Object.keys(o).length > 0);
}
function normalizeImportPost(input) {
    if (!input || typeof input !== "object")
        return null;
    const get = (keys) => {
        for (const k of keys) {
            const val = input[k];
            if (val !== undefined && val !== null && String(val).trim().length)
                return String(val).trim();
        }
        return undefined;
    };
    const title = get(["title", "Title"]);
    if (!title)
        return null;
    const tagsRaw = get(["tags", "Tags"]);
    const tags = tagsRaw
        ? tagsRaw.split(/[,|;]/).map((t) => t.trim()).filter(Boolean)
        : undefined;
    const status = get(["status", "Status"]);
    const publishedAt = get(["publishedAt", "PublishedAt", "published_at"]);
    return {
        title,
        slug: get(["slug", "Slug"]),
        excerpt: get(["excerpt", "Excerpt"]),
        coverImageUrl: get(["coverImageUrl", "cover_image_url", "CoverImageUrl"]),
        coverImageAbsolute: get(["coverImageAbsolute", "cover_image_absolute", "CoverImageAbsolute"]),
        contentHtml: get(["contentHtml", "content_html", "ContentHtml"]) || "<p></p>",
        tags,
        status,
        publishedAt,
    };
}
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
    const slugInput = parsed.data.slug?.trim();
    const slug = await ensureUniqueSlug(slugInput && slugInput.length ? slugInput : parsed.data.title, site.siteId);
    // Plan enforcement: free plan allows limited posts
    if (auth.role !== "SUPER_ADMIN") {
        const plan = await (0, accountSubscription_1.getAccountPlan)(auth.adminId);
        if (plan === client_1.Plan.FREE) {
            const postCount = await prisma_1.prisma.blogPost.count({ where: { siteId: site.siteId } });
            if (postCount >= plans_1.FREE_POST_LIMIT) {
                return res.status(402).json({
                    message: "Free plan limit reached. Upgrade to create more posts.",
                    plans: plans_1.PLANS.filter((p) => p.id !== "FREE"),
                });
            }
        }
    }
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
        const uniqueTags = Array.from(new Map(parsed.data.tags
            .map((t) => t?.trim())
            .filter(Boolean)
            .map((t) => [(0, slugify_1.default)(t, { lower: true, strict: true }), t])).values());
        for (const t of uniqueTags) {
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
    let nextSlug;
    if (parsed.data.slug) {
        nextSlug = await ensureUniqueSlug(parsed.data.slug, site.siteId);
    }
    const post = await prisma_1.prisma.blogPost.update({
        where: { id: req.params.id },
        data: {
            title: parsed.data.title ?? undefined,
            slug: nextSlug ?? undefined,
            excerpt: parsed.data.excerpt ?? undefined,
            coverImageUrl: parsed.data.coverImageUrl ?? undefined,
            contentHtml: parsed.data.contentHtml ?? undefined,
        },
    });
    // replace tags if provided
    if (parsed.data.tags) {
        await prisma_1.prisma.blogPostTag.deleteMany({ where: { postId: post.id } });
        const uniqueTags = Array.from(new Map(parsed.data.tags
            .map((t) => t?.trim())
            .filter(Boolean)
            .map((t) => [(0, slugify_1.default)(t, { lower: true, strict: true }), t])).values());
        for (const t of uniqueTags) {
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
async function adminExportPosts(req, res) {
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    const origin = (process.env.APP_ORIGIN || "")
        .split(",")[0]
        .trim()
        .replace(/\/+$/, "") || `${req.protocol}://${req.get("host") || "localhost"}`;
    const posts = await prisma_1.prisma.blogPost.findMany({
        where: { siteId: site.siteId },
        orderBy: { updatedAt: "desc" },
        include: { tags: { include: { tag: true } } },
    });
    const siteInfo = await prisma_1.prisma.site.findUnique({
        where: { id: site.siteId },
        select: { name: true, slug: true, domains: true },
    });
    const domainLabel = siteInfo?.domains?.[0] ||
        siteInfo?.slug ||
        siteInfo?.name?.replace(/\s+/g, "-").toLowerCase() ||
        "site";
    const payload = posts.map((p) => ({
        title: p.title,
        slug: p.slug,
        excerpt: p.excerpt,
        coverImageUrl: p.coverImageUrl,
        coverImageAbsolute: p.coverImageUrl && !/^https?:\/\//i.test(p.coverImageUrl)
            ? `${origin}${p.coverImageUrl}`
            : p.coverImageUrl,
        contentHtml: p.contentHtml,
        tags: p.tags.map((t) => t.tag.name),
        status: p.status,
        publishedAt: p.publishedAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
    }));
    if (req.query.format === "csv") {
        const csv = postsToCsv(payload);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${domainLabel}-posts.csv"`);
        return res.send(csv);
    }
    res.json({ posts: payload, filename: `${domainLabel}-posts.json` });
}
async function adminImportPosts(req, res) {
    const auth = req.auth;
    const site = req.site;
    if (!site)
        return res.status(400).json({ message: "Site context missing" });
    if (!ensureCanMutateSite(auth, site.membershipRole)) {
        return res.status(403).json({ message: "You cannot import posts in this site" });
    }
    const parsePostsPayload = (input) => {
        if (!input)
            return undefined;
        if (Array.isArray(input))
            return input;
        if (typeof input === "string") {
            const trimmed = input.trim();
            if (!trimmed.length)
                return undefined;
            if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                try {
                    const parsed = JSON.parse(trimmed);
                    return Array.isArray(parsed) ? parsed : parsed.posts;
                }
                catch {
                    return undefined;
                }
            }
            return parseCsvPosts(trimmed);
        }
        if (typeof input === "object") {
            if (Array.isArray(input.posts))
                return input.posts;
            if (typeof input.posts === "string") {
                const maybe = parsePostsPayload(input.posts);
                if (Array.isArray(maybe))
                    return maybe;
            }
            if (input.csv && typeof input.csv === "string") {
                return parseCsvPosts(input.csv);
            }
        }
        return undefined;
    };
    const incomingPostsRaw = parsePostsPayload(req.body);
    const incomingPosts = (incomingPostsRaw || []).map((p) => normalizeImportPost(p)).filter(Boolean);
    if (!incomingPosts.length) {
        return res.status(400).json({ message: "Invalid import payload. Provide JSON or CSV with posts array." });
    }
    const parsed = importSchema.safeParse({ posts: incomingPosts });
    if (!parsed.success)
        return res.status(400).json(parsed.error.flatten());
    const created = [];
    for (const data of parsed.data.posts) {
        const slugInput = data.slug?.trim();
        const slug = await ensureUniqueSlug(slugInput && slugInput.length ? slugInput : data.title, site.siteId);
        const status = data.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT";
        const publishedAt = status === "PUBLISHED" ? (data.publishedAt ? new Date(data.publishedAt) : new Date()) : null;
        const post = await prisma_1.prisma.blogPost.create({
            data: {
                siteId: site.siteId,
                title: data.title,
                slug,
                excerpt: data.excerpt,
                coverImageUrl: data.coverImageUrl || data.coverImageAbsolute,
                contentHtml: data.contentHtml,
                authorId: auth.adminId,
                status,
                publishedAt,
            },
        });
        if (data.tags?.length) {
            const uniqueTags = Array.from(new Map(data.tags
                .map((t) => t?.trim())
                .filter(Boolean)
                .map((t) => [(0, slugify_1.default)(t, { lower: true, strict: true }), t])).values());
            for (const t of uniqueTags) {
                const tagSlug = (0, slugify_1.default)(t, { lower: true, strict: true });
                const tag = await prisma_1.prisma.tag.upsert({
                    where: { siteId_slug: { siteId: site.siteId, slug: tagSlug } },
                    update: { name: t },
                    create: { siteId: site.siteId, name: t, slug: tagSlug },
                });
                await prisma_1.prisma.blogPostTag.create({ data: { postId: post.id, tagId: tag.id } });
            }
        }
        created.push({
            id: post.id,
            slug: post.slug,
            title: post.title,
            status: post.status,
            excerpt: post.excerpt,
            coverImageUrl: post.coverImageUrl,
            contentHtml: post.contentHtml,
            tags: data.tags ?? [],
        });
    }
    res.json({ imported: created.length, posts: created });
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
                contentHtml: true,
                createdAt: true,
                updatedAt: true,
                publishedAt: true,
                author: { select: { id: true, name: true, email: true } },
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
            createdAt: true,
            updatedAt: true,
            publishedAt: true,
            author: { select: { id: true, name: true, email: true } },
            tags: { select: { tag: { select: { name: true, slug: true } } } },
        },
    });
    if (!post)
        return res.status(404).json({ message: "Not found" });
    res.json({ post });
}
