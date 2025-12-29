import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { sendMail } from "../utils/mailer";
import crypto from "crypto";
import slugify from "slugify";
import { SiteRole } from "@prisma/client";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const signupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
});

const resetRequestSchema = z.object({
  email: z.string().email(),
});

const resetConfirmSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(6),
});

async function ensureDefaultSite(adminId: string, adminName: string) {
  const existingSite = await prisma.adminSiteMembership.findFirst({ where: { adminId } });
  if (existingSite) return;

  let base = adminName || "Main Site";
  if (base.length < 3) base = "site";
  let slug = slugify(base, { lower: true, strict: true });
  let i = 1;

  while (true) {
    const exists = await prisma.site.findUnique({ where: { slug } });
    if (!exists) break;
    slug = `${slugify(base, { lower: true, strict: true })}-${i++}`;
  }

  const site = await prisma.site.create({
    data: { name: `${adminName || "My"} Site`, slug, domains: [] },
  });

  await prisma.adminSiteMembership.create({
    data: { adminId, siteId: site.id, role: SiteRole.OWNER },
  });
}

function getJwtConfig() {
  const jwtSecret = process.env.JWT_SECRET as Secret | undefined;
  if (!jwtSecret) {
    throw new Error("JWT secret is not configured");
  }
  const expiresIn: SignOptions["expiresIn"] =
    (process.env.JWT_EXPIRES_IN as SignOptions["expiresIn"]) ?? "7d";
  return { jwtSecret, expiresIn };
}

function getCookieOptions() {
  const sameSiteEnv = (process.env.COOKIE_SAMESITE || "").toLowerCase();
  const sameSite = (sameSiteEnv === "none" ? "none" : sameSiteEnv === "lax" ? "lax" : undefined) as
    | "lax"
    | "none"
    | undefined;
  const useNone = sameSite === "none";
  return {
    httpOnly: true,
    sameSite: useNone ? "none" : "lax",
    secure: useNone || process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  } as const;
}

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { email, password } = parsed.data;
  const { jwtSecret, expiresIn } = getJwtConfig();

  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) return res.status(401).json({ message: "Invalid credentials" });

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return res.status(401).json({ message: "Invalid credentials" });

  await ensureDefaultSite(admin.id, admin.name);

  const token = jwt.sign(
    { adminId: admin.id, role: admin.role },
    jwtSecret,
    { expiresIn }
  );

  // cookie-based auth (best for admin panel)
  res.cookie("accessToken", token, getCookieOptions());

  return res.json({
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  });
}

export async function signup(req: Request, res: Response) {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { name, email, password } = parsed.data;
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) return res.status(400).json({ message: "Email already in use" });

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.adminUser.create({
    data: { name, email, passwordHash, role: "EDITOR" },
  });

  await ensureDefaultSite(admin.id, admin.name);

  const { jwtSecret, expiresIn } = getJwtConfig();
  const token = jwt.sign({ adminId: admin.id, role: admin.role }, jwtSecret, { expiresIn });

  res.cookie("accessToken", token, getCookieOptions());

  return res.status(201).json({
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  });
}

export async function me(req: Request, res: Response) {
  const auth = (req as any).auth as { adminId: string };
  const admin = await prisma.adminUser.findUnique({
    where: { id: auth.adminId },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  return res.json({ admin });
}

export async function logout(_req: Request, res: Response) {
  const opts = getCookieOptions();
  res.clearCookie("accessToken", opts);
  return res.json({ ok: true });
}

export async function requestPasswordReset(req: Request, res: Response) {
  const parsed = resetRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const admin = await prisma.adminUser.findUnique({ where: { email: parsed.data.email } });
  if (!admin) return res.json({ ok: true }); // do not reveal existence

  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 1000 * 60 * 30); // 30 mins

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { resetToken: token, resetExpires: expires },
  });

  const baseUrl = process.env.APP_ORIGIN || "http://localhost:5173";
  const resetLink = `${baseUrl}/reset-password?token=${token}`;

  const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT);

  if (hasSmtp) {
    try {
      await sendMail({
        to: admin.email,
        subject: "Reset your Sapphire CMS password",
        html: `<p>Hello ${admin.name},</p><p>Click the link to reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p><p>This link expires in 30 minutes.</p>`,
      });
    } catch (err) {
      console.error("Mailer error", err);
      // Do not block the flow; still allow reset by returning the link in non-production for debugging.
      if (process.env.NODE_ENV !== "production") {
        return res.json({ ok: true, resetLink });
      }
    }
  } else {
    console.warn("SMTP not configured; cannot send reset email. Reset link:", resetLink);
    if (process.env.NODE_ENV !== "production") {
      return res.json({ ok: true, resetLink });
    }
  }

  return res.json({ ok: true });
}

export async function confirmPasswordReset(req: Request, res: Response) {
  const parsed = resetConfirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { token, password } = parsed.data;

  const admin = await prisma.adminUser.findFirst({
    where: { resetToken: token, resetExpires: { gt: new Date() } },
  });

  if (!admin) return res.status(400).json({ message: "Invalid or expired token" });

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { passwordHash, resetToken: null, resetExpires: null },
  });

  return res.json({ ok: true });
}
