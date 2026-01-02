import { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../config/prisma";
import { JwtPayload } from "./auth";
import { ApiTokenRole, SiteRole } from "@prisma/client";

export type SiteContext = {
  siteId: string;
  membershipRole: SiteRole | null;
};

export type SiteTokenContext = {
  siteId: string;
  tokenRole: ApiTokenRole;
};

function getSiteId(req: Request) {
  return (
    req.header("x-site-id") ||
    req.query.siteId ||
    (req.body as any)?.siteId ||
    (req.params as any)?.siteId ||
    (req.params as any)?.id ||
    ""
  )
    .toString()
    .trim();
}

export async function requireSiteAccess(req: Request, res: Response, next: NextFunction) {
  const siteId = getSiteId(req);
  if (!siteId) return res.status(400).json({ message: "Missing site id" });

  const auth = (req as any).auth as JwtPayload | undefined;
  if (!auth) return res.status(401).json({ message: "Unauthorized" });

  const membership = await prisma.adminSiteMembership.findFirst({
    where: { siteId, adminId: auth.adminId },
  });

  const isSuperAdmin = auth.role === "SUPER_ADMIN";
  if (!membership && !isSuperAdmin) {
    return res.status(403).json({ message: "You do not have access to this site" });
  }

  (req as any).site = {
    siteId,
    membershipRole: membership?.role ?? null,
  } as SiteContext;

  next();
}

export async function requirePublicSiteToken(req: Request, res: Response, next: NextFunction) {
  const token = (req.header("x-site-token") || req.query.token || "").toString().trim();
  if (!token) return res.status(401).json({ message: "Missing site token" });

  const hashed = crypto.createHash("sha256").update(token).digest("hex");

  const apiToken = await prisma.apiToken.findFirst({
    where: {
      hashed,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });

  if (!apiToken) return res.status(401).json({ message: "Invalid or expired site token" });

  // Async but non-blocking last used update
  prisma.apiToken
    .update({ where: { id: apiToken.id }, data: { lastUsedAt: new Date() } })
    .catch((err) => console.error("Failed to update token usage", err));

  (req as any).siteToken = {
    siteId: apiToken.siteId,
    tokenRole: apiToken.role,
  } as SiteTokenContext;

  next();
}
