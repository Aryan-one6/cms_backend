import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import bcrypt from "bcrypt";
import { z } from "zod";
import { AdminRole } from "@prisma/client";

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = (req as any).auth as { role?: string } | undefined;
  if (!auth || auth.role !== "SUPER_ADMIN") {
    return res.status(403).json({ message: "Super admin access required" });
  }
  next();
}

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.nativeEnum(AdminRole).optional().default(AdminRole.EDITOR),
});

const updateUserSchema = z.object({
  role: z.nativeEnum(AdminRole).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"] as const).optional(),
});

const updateSiteStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"] as const),
});

export async function listUsers(_req: Request, res: Response) {
  const users = await prisma.adminUser.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { memberships: true, posts: true },
      },
    },
  });
  res.json({ users });
}

export async function createUser(req: Request, res: Response) {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const exists = await prisma.adminUser.findUnique({ where: { email: parsed.data.email } });
  if (exists) return res.status(400).json({ message: "Email already exists" });

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.adminUser.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
      role: parsed.data.role,
      status: "ACTIVE",
    } as any,
  });

  res.status(201).json({ user });
}

export async function updateUser(req: Request, res: Response) {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const user = await prisma.adminUser.findUnique({ where: { id: req.params.userId } });
  if (!user) return res.status(404).json({ message: "User not found" });

  const updated = await prisma.adminUser.update({
    where: { id: user.id },
    data: ({
      ...(parsed.data.role ? { role: parsed.data.role } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    } as any),
  });

  res.json({ user: updated });
}

export async function deleteUser(req: Request, res: Response) {
  const self = (req as any).auth as { adminId?: string } | undefined;
  if (self?.adminId === req.params.userId) {
    return res.status(400).json({ message: "You cannot delete your own account" });
  }

  const user = await prisma.adminUser.findUnique({ where: { id: req.params.userId } });
  if (!user) return res.status(404).json({ message: "User not found" });

  await prisma.$transaction([
    prisma.adminSiteMembership.deleteMany({ where: { adminId: user.id } }),
    prisma.blogPost.deleteMany({ where: { authorId: user.id } }),
    prisma.adminUser.delete({ where: { id: user.id } }),
  ]);

  res.json({ ok: true });
}

export async function listSites(_req: Request, res: Response) {
  const sites = await prisma.site.findMany({
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

export async function updateSiteStatus(req: Request, res: Response) {
  const parsed = updateSiteStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const site = await prisma.site.findUnique({ where: { id: req.params.siteId } });
  if (!site) return res.status(404).json({ message: "Site not found" });

  const updated = await prisma.site.update({
    where: { id: site.id },
    data: { status: parsed.data.status } as any,
  });
  res.json({ site: updated });
}

export async function deleteSiteSuper(req: Request, res: Response) {
  const siteId = req.params.siteId;
  if (!siteId) return res.status(400).json({ message: "Missing site id" });

  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) return res.status(404).json({ message: "Site not found" });

  await prisma.$transaction([
    prisma.blogPostTag.deleteMany({ where: { post: { siteId } } }),
    prisma.blogPost.deleteMany({ where: { siteId } }),
    prisma.tag.deleteMany({ where: { siteId } }),
    prisma.apiToken.deleteMany({ where: { siteId } }),
    prisma.siteDomain.deleteMany({ where: { siteId } }),
    prisma.adminSiteMembership.deleteMany({ where: { siteId } }),
    prisma.site.delete({ where: { id: siteId } }),
  ]);

  res.json({ ok: true });
}

export async function listPosts(_req: Request, res: Response) {
  const posts = await prisma.blogPost.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      site: { select: { id: true, name: true } },
      author: { select: { id: true, name: true, email: true } },
    },
  });
  res.json({ posts });
}

export async function deletePostSuper(req: Request, res: Response) {
  const post = await prisma.blogPost.findUnique({ where: { id: req.params.postId } });
  if (!post) return res.status(404).json({ message: "Post not found" });

  await prisma.blogPostTag.deleteMany({ where: { postId: post.id } });
  await prisma.blogPost.delete({ where: { id: post.id } });

  res.json({ ok: true });
}
