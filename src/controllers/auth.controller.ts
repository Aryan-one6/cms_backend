import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { signAdminToken, getCookieOptions } from "../utils/authTokens";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { sendMail } from "../utils/mailer";
import crypto from "crypto";
import { SiteRole } from "@prisma/client";
import { randomBytes } from "crypto";
import { ensureAccountSubscription } from "../utils/accountSubscription";
import { ensureDefaultSite } from "../utils/ensureDefaultSite";
import slugify from "slugify";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const signupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  siteName: z.string().min(2),
  domain: z.string().min(3),
});

const resetRequestSchema = z.object({
  email: z.string().email(),
});

const resetConfirmSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(6),
});

const setPasswordSchema = z.object({
  password: z.string().min(6),
  email: z.string().email().optional(),
});


function normalizeDomain(domain: string) {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function generateDomainToken() {
  return randomBytes(16).toString("hex");
}


export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { email, password } = parsed.data;
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) return res.status(401).json({ message: "Invalid credentials" });
  if (!admin.passwordHash) {
    return res.status(401).json({ message: "This account uses Google/GitHub login." });
  }

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return res.status(401).json({ message: "Invalid credentials" });

  await ensureDefaultSite(admin.id, admin.name);
  await ensureAccountSubscription(admin.id);

  const token = signAdminToken({ adminId: admin.id, role: admin.role });

  // cookie-based auth (best for admin panel)
  res.cookie("accessToken", token, getCookieOptions());

  return res.json({
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      hasPassword: Boolean(admin.passwordHash),
    },
  });
}

export async function signup(req: Request, res: Response) {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { name, email, password, siteName, domain } = parsed.data;
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) return res.status(400).json({ message: "Email already in use" });

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.adminUser.create({
    data: { name, email, passwordHash, role: "EDITOR" },
  });

  // Create primary site using provided info
  let slug = slugify(siteName, { lower: true, strict: true });
  let i = 1;
  while (true) {
    const exists = await prisma.site.findUnique({ where: { slug } });
    if (!exists) break;
    slug = `${slugify(siteName, { lower: true, strict: true })}-${i++}`;
  }
  const primaryDomain = normalizeDomain(domain);
  const site = await prisma.site.create({
    data: { name: siteName, slug, domains: primaryDomain ? [primaryDomain] : [] },
  });

  await prisma.adminSiteMembership.create({
    data: { adminId: admin.id, siteId: site.id, role: SiteRole.OWNER },
  });

  if (primaryDomain) {
    await prisma.siteDomain.create({
      data: {
        siteId: site.id,
        domain: primaryDomain,
        verificationToken: generateDomainToken(),
        status: "PENDING",
      },
    });
  }

  await prisma.adminUser.update({ where: { id: admin.id }, data: { primarySiteId: site.id } });
  await ensureAccountSubscription(admin.id);

  const token = signAdminToken({ adminId: admin.id, role: admin.role });

  res.cookie("accessToken", token, getCookieOptions());

  return res.status(201).json({
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      hasPassword: Boolean(admin.passwordHash),
    },
  });
}

const adminSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  avatarUrl: true,
  passwordHash: true,
  accountSubscription: {
    select: { plan: true, status: true, expiresAt: true, startedAt: true },
  },
};

function toAdminResponse<T extends { passwordHash?: string | null }>(admin: T | null) {
  if (!admin) return null;
  const { passwordHash, ...rest } = admin;
  return { ...rest, hasPassword: Boolean(passwordHash) };
}

export async function me(req: Request, res: Response) {
  const auth = (req as any).auth as { adminId: string };
  const admin = await prisma.adminUser.findUnique({
    where: { id: auth.adminId },
    select: adminSelect,
  });
  if (admin && !admin.accountSubscription) {
    await ensureAccountSubscription(admin.id);
    const refreshed = await prisma.adminUser.findUnique({
      where: { id: auth.adminId },
      select: adminSelect,
    });
    return res.json({ admin: toAdminResponse(refreshed) });
  }
  return res.json({ admin: toAdminResponse(admin) });
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

  const baseUrl =
    (process.env.APP_ORIGIN || "http://localhost:5173")
      .split(",")[0]
      .trim()
      .replace(/\/+$/, "") || "http://localhost:5173";
  const resetLink = `${baseUrl}/reset-password?token=${token}`;

  const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT);

  if (hasSmtp) {
    try {
      const brand = "TRIAD CMS";
      const brandTagline = "AI-Powered Headless CMS";
      const logoUrl =
        process.env.BRAND_LOGO_URL ||
        `${baseUrl}/logo.png`;
      const year = new Date().getFullYear();
      const html = `
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#0b1223;background:#f8fafc;">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 30px rgba(15,23,42,0.06);">
                <tr>
                  <td style="padding:24px 24px 12px 24px;border-bottom:1px solid #e2e8f0;" align="center">
                    <img src="${logoUrl}" width="64" height="64" alt="${brand} logo" style="display:block;margin:0 auto 12px auto;border-radius:14px;" />
                    <div style="font-size:20px;font-weight:700;color:#0f172a;letter-spacing:0.02em;">${brand}</div>
                    <div style="font-size:12px;color:#475569;margin-top:4px;">${brandTagline}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 24px 12px 24px;">
                    <div style="font-size:12px;font-weight:700;color:#0ea5e9;letter-spacing:0.16em;text-transform:uppercase;">Security</div>
                    <div style="font-size:22px;font-weight:700;color:#0f172a;margin:6px 0 12px 0;">Password reset request</div>
                    <p style="margin:0 0 12px 0;font-size:15px;color:#0f172a;">Hello ${admin.name},</p>
                    <p style="margin:0 0 16px 0;font-size:15px;color:#0f172a;">We received a request to reset the password for your ${brand} account. Click the button below to choose a new password.</p>
                    <p style="margin:0 0 20px 0;" align="center">
                      <a href="${resetLink}" style="display:inline-block;padding:12px 20px;background:linear-gradient(135deg,#22c55e,#0ea5e9);color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;box-shadow:0 8px 18px rgba(14,165,233,0.28);">Reset password</a>
                    </p>
                    <p style="margin:0 0 12px 0;font-size:13px;color:#475569;">If the button doesn't work, copy and paste this link into your browser:</p>
                    <p style="margin:0 0 16px 0;word-break:break-all;font-size:13px;">
                      <a href="${resetLink}" style="color:#0f172a;">${resetLink}</a>
                    </p>
                    <p style="margin:0 0 8px 0;font-size:13px;color:#475569;">This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
                    © ${year} ${brand}. All rights reserved.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `;

      await sendMail({
        to: admin.email,
        subject: "Reset your TRIAD CMS password",
        html,
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

export async function setPassword(req: Request, res: Response) {
  const auth = (req as any).auth as { adminId: string };
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const admin = await prisma.adminUser.findUnique({
    where: { id: auth.adminId },
    select: { id: true, name: true, email: true, role: true, passwordHash: true },
  });

  if (!admin) return res.status(404).json({ message: "Admin not found" });
  if (admin.passwordHash) {
    return res.status(400).json({ message: "Password already set. Use reset password instead." });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const nextEmail = parsed.data.email?.trim();
  if (nextEmail && nextEmail !== admin.email) {
    const existing = await prisma.adminUser.findUnique({ where: { email: nextEmail } });
    if (existing) {
      return res.status(400).json({ message: "Email already in use." });
    }
  }
  const updated = await prisma.adminUser.update({
    where: { id: admin.id },
    data: {
      passwordHash,
      ...(nextEmail && nextEmail !== admin.email ? { email: nextEmail } : {}),
    },
    select: { id: true, name: true, email: true, role: true, passwordHash: true },
  });

  return res.json({
    admin: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      hasPassword: Boolean(updated.passwordHash),
    },
  });
}
