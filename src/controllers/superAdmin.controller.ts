import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import bcrypt from "bcrypt";
import { z } from "zod";
import { AdminRole, Plan } from "@prisma/client";
import { PLANS } from "../config/plans";
import {
  listCoupons,
  findCouponByCode,
  createCoupon as createCouponStore,
  updateCoupon as updateCouponStore,
  deleteCoupon as deleteCouponStore,
  findCouponById,
  CouponRecord,
} from "../utils/couponStore";

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

const couponSchema = z.object({
  code: z.string().min(2).max(40),
  amountOffPaise: z.number().int().nonnegative().optional(),
  percentOff: z.number().min(1).max(100).optional(),
  maxRedemptions: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
  validFrom: z.string().datetime().optional(),
  applicablePlans: z.array(z.nativeEnum(Plan)).nonempty().optional(),
  minOrderPaise: z.number().int().nonnegative().optional(),
  minMonths: z.number().int().nonnegative().optional(),
  notes: z.string().max(200).optional(),
  active: z.boolean().optional().default(true),
});

function priceForPlan(plan: Plan) {
  const entry = PLANS.find((p) => p.plan === plan);
  return entry?.pricePaise ?? 0;
}

export async function listUsers(_req: Request, res: Response) {
  const users = await prisma.adminUser.findMany({
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
  if (user.role === "SUPER_ADMIN") return res.status(400).json({ message: "Super admin cannot be modified" });

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
  if (user.role === "SUPER_ADMIN") return res.status(400).json({ message: "Super admin cannot be deleted" });

  const posts = await prisma.blogPost.findMany({ where: { authorId: user.id }, select: { id: true } });
  const postIds = posts.map((p) => p.id);

  await prisma.$transaction([
    prisma.blogPostTag.deleteMany({ where: { postId: { in: postIds } } }),
    prisma.blogPost.deleteMany({ where: { id: { in: postIds } } }),
    prisma.adminSiteMembership.deleteMany({ where: { adminId: user.id } }),
    prisma.accountSubscription.deleteMany({ where: { adminId: user.id } }),
    prisma.adminUser.delete({ where: { id: user.id } }),
  ]);

  // Cleanup orphaned sites (no memberships left)
  const orphanSites = await prisma.site.findMany({
    where: { memberships: { none: {} } },
    select: { id: true },
  });
  if (orphanSites.length) {
    const ids = orphanSites.map((s) => s.id);
    await prisma.$transaction([
      prisma.blogPostTag.deleteMany({ where: { post: { siteId: { in: ids } } } }),
      prisma.blogPost.deleteMany({ where: { siteId: { in: ids } } }),
      prisma.tag.deleteMany({ where: { siteId: { in: ids } } }),
      prisma.apiToken.deleteMany({ where: { siteId: { in: ids } } }),
      prisma.siteDomain.deleteMany({ where: { siteId: { in: ids } } }),
      prisma.site.deleteMany({ where: { id: { in: ids } } }),
    ]);
  }

  res.json({ ok: true });
}

export async function listSites(_req: Request, res: Response) {
  const sites = await prisma.site.findMany({
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

export async function listSubscriptions(_req: Request, res: Response) {
  const subs = await prisma.accountSubscription.findMany({
    orderBy: { createdAt: "desc" },
    include: { admin: { select: { id: true, name: true, email: true } } },
  });
  res.json({ subscriptions: subs });
}

export async function getMetrics(_req: Request, res: Response) {
  const [users, sites, posts, subs] = await Promise.all([
    prisma.adminUser.count({ where: { role: { not: "SUPER_ADMIN" } } }),
    prisma.site.count(),
    prisma.blogPost.count(),
    prisma.accountSubscription.findMany({ where: { status: "active" } }),
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

export async function listCouponsSuper(_req: Request, res: Response) {
  const defaults: CouponRecord[] = [
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
  const coupons = await listCoupons();
  const merged = [...defaults, ...coupons.filter((c) => !defaults.find((d) => d.code === c.code))];
  res.json({ coupons: merged });
}

export async function createCouponSuper(req: Request, res: Response) {
  const parsed = couponSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  if (!parsed.data.amountOffPaise && !parsed.data.percentOff) {
    return res.status(400).json({ message: "Provide amountOffPaise or percentOff" });
  }

  const exists = await findCouponByCode(parsed.data.code.toUpperCase());
  if (exists) return res.status(400).json({ message: "Coupon code already exists" });

  const coupon = await createCouponStore({
    ...parsed.data,
    redeemed: 0,
  } as CouponRecord);
  res.status(201).json({ coupon });
}

export async function updateCouponSuper(req: Request, res: Response) {
  const parsed = couponSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const existing = await findCouponById(req.params.id);
  if (!existing) return res.status(404).json({ message: "Coupon not found" });
   if (existing.readOnly) return res.status(400).json({ message: "This coupon is read-only" });
  const updated = await updateCouponStore(req.params.id, parsed.data);
  res.json({ coupon: updated });
}

export async function deleteCouponSuper(req: Request, res: Response) {
  const existing = await findCouponById(req.params.id);
  if (!existing) return res.status(404).json({ message: "Coupon not found" });
  if (existing.readOnly) return res.status(400).json({ message: "This coupon is read-only" });
  await deleteCouponStore(req.params.id);
  res.json({ ok: true });
}
