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
