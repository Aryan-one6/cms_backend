import { Request, Response } from "express";
import { z } from "zod";
import slugify from "slugify";
import { prisma } from "../config/prisma";
import { JwtPayload } from "../middlewares/auth";
import { SiteContext, SiteTokenContext } from "../middlewares/site";
import { SiteRole } from "@prisma/client";

const createSchema = z.object({
  title: z.string().min(3),
  slug: z.string().optional(),
  excerpt: z.string().optional(),
  coverImageUrl: z.string().optional(),
  contentHtml: z.string().min(1),
  tags: z.array(z.string()).optional(), // tag names
});

const updateSchema = createSchema.partial();

const importPostSchema = z.object({
  title: z.string().min(3),
  slug: z.string().optional(),
  excerpt: z.string().optional(),
  coverImageUrl: z.string().optional(),
  coverImageAbsolute: z.string().optional(),
  contentHtml: z.string().min(1),
  tags: z.array(z.string()).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  publishedAt: z.string().datetime().optional(),
});

const importSchema = z.object({
  posts: z.array(importPostSchema).min(1, "No posts provided"),
});

function stringifyCsvField(value: any) {
  const str = value == null ? "" : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function postsToCsv(rows: any[]) {
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
    ...rows.map((row) =>
      headers
        .map((h) => {
          if (h === "tags" && Array.isArray(row.tags)) return stringifyCsvField(row.tags.join("|"));
          return stringifyCsvField(row[h]);
        })
        .join(",")
    ),
  ];
  return lines.join("\n");
}

function parseCsvPosts(csvText: string) {
  const rows: string[][] = [];
  let current = "";
  let field: string[] = [];
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
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      pushField();
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && csvText[i + 1] === "\n") i++;
      pushField();
      pushRow();
    } else {
      current += ch;
    }
  }
  pushField();
  pushRow();

  const [headerRow, ...dataRows] = rows.filter((r) => r.length && r.some((c) => c.trim().length));
  if (!headerRow) return [];
  const headers = headerRow.map((h) => h.trim().toLowerCase());

  return dataRows
    .map((cols) => {
      const obj: any = {};
      headers.forEach((h, idx) => {
        const val = cols[idx] ?? "";
        obj[h] = val.trim();
      });
      return obj;
    })
    .filter((o) => Object.keys(o).length > 0);
}

function normalizeImportPost(input: any) {
  if (!input || typeof input !== "object") return null;
  const get = (keys: string[]) => {
    for (const k of keys) {
      const val = (input as any)[k];
      if (val !== undefined && val !== null && String(val).trim().length) return String(val).trim();
    }
    return undefined;
  };

  const title = get(["title", "Title"]);
  if (!title) return null;

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

async function ensureUniqueSlug(base: string, siteId: string) {
  let slug = slugify(base, { lower: true, strict: true });
  let i = 1;

  while (true) {
    const exists = await prisma.blogPost.findFirst({ where: { slug, siteId } });
    if (!exists) return slug;
    slug = `${slugify(base, { lower: true, strict: true })}-${i++}`;
  }
}

function canEditPost(auth: JwtPayload, membershipRole: SiteRole | null, authorId: string) {
  if (auth.role === "SUPER_ADMIN") return true;
  if (membershipRole === SiteRole.OWNER) return true;
  if (membershipRole === SiteRole.EDITOR) return auth.adminId === authorId;
  return false;
}

function ensureCanMutateSite(auth: JwtPayload, membershipRole: SiteRole | null) {
  if (
    auth.role === "SUPER_ADMIN" ||
    membershipRole === SiteRole.OWNER ||
    membershipRole === SiteRole.EDITOR
  ) {
    return true;
  }
  return false;
}

export async function adminListPosts(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });

  const posts = await prisma.blogPost.findMany({
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

export async function adminGetPost(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });

  const post = await prisma.blogPost.findUnique({
    where: { id: req.params.id },
    include: { tags: { include: { tag: true } }, author: { select: { id: true, name: true } } },
  });
  if (!post || post.siteId !== site.siteId) return res.status(404).json({ message: "Not found" });
  res.json({ post: { ...post, canEdit: canEditPost(auth, site.membershipRole, post.authorId) } });
}

export async function adminCreatePost(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });
  if (!ensureCanMutateSite(auth, site.membershipRole)) {
    return res.status(403).json({ message: "You cannot create posts in this site" });
  }

  const slugInput = parsed.data.slug?.trim();
  const slug = await ensureUniqueSlug(slugInput && slugInput.length ? slugInput : parsed.data.title, site.siteId);

  const post = await prisma.blogPost.create({
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
    const uniqueTags = Array.from(
      new Map(
        parsed.data.tags
          .map((t) => t?.trim())
          .filter(Boolean)
          .map((t) => [slugify(t!, { lower: true, strict: true }), t!])
      ).values()
    );

    for (const t of uniqueTags) {
      const tagSlug = slugify(t, { lower: true, strict: true });
      const tag = await prisma.tag.upsert({
        where: { siteId_slug: { siteId: site.siteId, slug: tagSlug } },
        update: { name: t },
        create: { siteId: site.siteId, name: t, slug: tagSlug },
      });
      await prisma.blogPostTag.create({ data: { postId: post.id, tagId: tag.id } });
    }
  }

  res.status(201).json({ post });
}

export async function adminUpdatePost(req: Request, res: Response) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });

  const existing = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.siteId !== site.siteId) return res.status(404).json({ message: "Not found" });
  if (!canEditPost(auth, site.membershipRole, existing.authorId)) {
    return res.status(403).json({ message: "You can only edit your own posts" });
  }

  let nextSlug: string | undefined;
  if (parsed.data.slug) {
    nextSlug = await ensureUniqueSlug(parsed.data.slug, site.siteId);
  }

  const post = await prisma.blogPost.update({
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
    await prisma.blogPostTag.deleteMany({ where: { postId: post.id } });

    const uniqueTags = Array.from(
      new Map(
        parsed.data.tags
          .map((t) => t?.trim())
          .filter(Boolean)
          .map((t) => [slugify(t!, { lower: true, strict: true }), t!])
      ).values()
    );

    for (const t of uniqueTags) {
      const tagSlug = slugify(t, { lower: true, strict: true });
      const tag = await prisma.tag.upsert({
        where: { siteId_slug: { siteId: site.siteId, slug: tagSlug } },
        update: { name: t },
        create: { siteId: site.siteId, name: t, slug: tagSlug },
      });
      await prisma.blogPostTag.create({ data: { postId: post.id, tagId: tag.id } });
    }
  }

  res.json({ post });
}

export async function adminDeletePost(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });

  const existing = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.siteId !== site.siteId) return res.status(404).json({ message: "Not found" });
  if (!canEditPost(auth, site.membershipRole, existing.authorId)) {
    return res.status(403).json({ message: "You can only delete your own posts" });
  }

  await prisma.blogPost.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}

export async function adminExportPosts(req: Request, res: Response) {
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });

  const origin = process.env.APP_ORIGIN || `${req.protocol}://${req.get("host") || "localhost"}`;

  const posts = await prisma.blogPost.findMany({
    where: { siteId: site.siteId },
    orderBy: { updatedAt: "desc" },
    include: { tags: { include: { tag: true } } },
  });

  const siteInfo = await prisma.site.findUnique({
    where: { id: site.siteId },
    select: { name: true, slug: true, domains: true },
  });
  const domainLabel =
    siteInfo?.domains?.[0] ||
    siteInfo?.slug ||
    siteInfo?.name?.replace(/\s+/g, "-").toLowerCase() ||
    "site";

  const payload = posts.map((p) => ({
    title: p.title,
    slug: p.slug,
    excerpt: p.excerpt,
    coverImageUrl: p.coverImageUrl,
    coverImageAbsolute:
      p.coverImageUrl && !/^https?:\/\//i.test(p.coverImageUrl)
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

export async function adminImportPosts(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });
  if (!ensureCanMutateSite(auth, site.membershipRole)) {
    return res.status(403).json({ message: "You cannot import posts in this site" });
  }

  const parsePostsPayload = (input: any): any[] | undefined => {
    if (!input) return undefined;
    if (Array.isArray(input)) return input;
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed.length) return undefined;
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed) ? parsed : parsed.posts;
        } catch {
          return undefined;
        }
      }
      return parseCsvPosts(trimmed);
    }
    if (typeof input === "object") {
      if (Array.isArray(input.posts)) return input.posts;
      if (typeof input.posts === "string") {
        const maybe = parsePostsPayload(input.posts);
        if (Array.isArray(maybe)) return maybe;
      }
      if (input.csv && typeof input.csv === "string") {
        return parseCsvPosts(input.csv);
      }
    }
    return undefined;
  };

  const incomingPostsRaw = parsePostsPayload(req.body);
  const incomingPosts = (incomingPostsRaw || []).map((p: any) => normalizeImportPost(p)).filter(Boolean);

  if (!incomingPosts.length) {
    return res.status(400).json({ message: "Invalid import payload. Provide JSON or CSV with posts array." });
  }

  const parsed = importSchema.safeParse({ posts: incomingPosts });
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const created = [];

  for (const data of parsed.data.posts) {
    const slugInput = data.slug?.trim();
    const slug = await ensureUniqueSlug(slugInput && slugInput.length ? slugInput : data.title, site.siteId);
    const status = data.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT";
    const publishedAt = status === "PUBLISHED" ? (data.publishedAt ? new Date(data.publishedAt) : new Date()) : null;

    const post = await prisma.blogPost.create({
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
      const uniqueTags = Array.from(
        new Map(
          data.tags
            .map((t) => t?.trim())
            .filter(Boolean)
            .map((t) => [slugify(t!, { lower: true, strict: true }), t!])
        ).values()
      );

      for (const t of uniqueTags) {
        const tagSlug = slugify(t, { lower: true, strict: true });
        const tag = await prisma.tag.upsert({
          where: { siteId_slug: { siteId: site.siteId, slug: tagSlug } },
          update: { name: t },
          create: { siteId: site.siteId, name: t, slug: tagSlug },
        });
        await prisma.blogPostTag.create({ data: { postId: post.id, tagId: tag.id } });
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

export async function adminDashboard(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });

  const [
    admin,
    totalPosts,
    myPosts,
    myPublished,
    myDrafts,
    teamPosts,
    myRecentPosts,
    teamRecentPosts,
    recentActivity,
  ] = await Promise.all([
    prisma.adminUser.findUnique({
      where: { id: auth.adminId },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
    prisma.blogPost.count({ where: { siteId: site.siteId } }),
    prisma.blogPost.count({ where: { authorId: auth.adminId, siteId: site.siteId } }),
    prisma.blogPost.count({
      where: { authorId: auth.adminId, status: "PUBLISHED", siteId: site.siteId },
    }),
    prisma.blogPost.count({
      where: { authorId: auth.adminId, status: "DRAFT", siteId: site.siteId },
    }),
    prisma.blogPost.count({ where: { authorId: { not: auth.adminId }, siteId: site.siteId } }),
    prisma.blogPost.findMany({
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
    prisma.blogPost.findMany({
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
    prisma.blogPost.findMany({
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

  if (!admin) return res.status(404).json({ message: "Admin not found" });

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

export async function publishPost(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });

  const existing = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.siteId !== site.siteId) return res.status(404).json({ message: "Not found" });
  if (!canEditPost(auth, site.membershipRole, existing.authorId)) {
    return res.status(403).json({ message: "You can only publish your own posts" });
  }

  const post = await prisma.blogPost.update({
    where: { id: req.params.id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });
  res.json({ post });
}

export async function unpublishPost(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });

  const existing = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.siteId !== site.siteId) return res.status(404).json({ message: "Not found" });
  if (!canEditPost(auth, site.membershipRole, existing.authorId)) {
    return res.status(403).json({ message: "You can only unpublish your own posts" });
  }

  const post = await prisma.blogPost.update({
    where: { id: req.params.id },
    data: { status: "DRAFT", publishedAt: null },
  });
  res.json({ post });
}

// PUBLIC
export async function publicListPosts(req: Request, res: Response) {
  const siteToken = (req as any).siteToken as SiteTokenContext | undefined;
  if (!siteToken) return res.status(401).json({ message: "Missing site token" });

  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
  const search = String(req.query.search || "").trim();
  const tag = String(req.query.tag || "").trim();

  const where: any = {
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
    prisma.blogPost.count({ where }),
    prisma.blogPost.findMany({
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

export async function publicGetPostBySlug(req: Request, res: Response) {
  const siteToken = (req as any).siteToken as SiteTokenContext | undefined;
  if (!siteToken) return res.status(401).json({ message: "Missing site token" });

  const post = await prisma.blogPost.findFirst({
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
  if (!post) return res.status(404).json({ message: "Not found" });
  res.json({ post });
}
