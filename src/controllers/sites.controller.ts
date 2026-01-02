import { Request, Response } from "express";
import { z } from "zod";
import slugify from "slugify";
import crypto from "crypto";
import { prisma } from "../config/prisma";
import { JwtPayload } from "../middlewares/auth";
import { SiteContext } from "../middlewares/site";
import { ApiTokenRole, Prisma, SiteRole } from "@prisma/client";
import dns from "dns/promises";
import axios from "axios";
import { getAccountPlan, getAccountSubscription } from "../utils/accountSubscription";
import { getSiteLimit, PLANS } from "../config/plans";

const createSiteSchema = z.object({
  name: z.string().min(2),
  domains: z.array(z.string()).optional(),
  defaultLocale: z.string().optional(),
  settingsJson: z.record(z.string(), z.any()).optional(),
});

const createTokenSchema = z.object({
  name: z.string().min(2),
  role: z.nativeEnum(ApiTokenRole).optional().default(ApiTokenRole.READ_ONLY),
  expiresAt: z.string().optional(),
});

const addDomainSchema = z.object({
  domain: z.string().min(3),
});

async function ensureUniqueSiteSlug(base: string) {
  let slug = slugify(base, { lower: true, strict: true });
  let i = 1;

  while (true) {
    const exists = await prisma.site.findUnique({ where: { slug } });
    if (!exists) return slug;
    slug = `${slugify(base, { lower: true, strict: true })}-${i++}`;
  }
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generatePlainToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function listSites(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;

  const memberships = await prisma.adminSiteMembership.findMany({
    where: { adminId: auth.adminId },
    include: { site: { include: { siteDomains: true } } },
  });
  const accountSub = await getAccountSubscription(auth.adminId);

  const memberSites = memberships.map((m) => ({
    ...m.site,
    siteDomains: m.site.siteDomains,
    subscription: accountSub
      ? {
          plan: accountSub.plan,
          status: accountSub.status,
          expiresAt: accountSub.expiresAt,
          startedAt: accountSub.startedAt,
        }
      : {
          plan: "FREE",
          status: "active",
          expiresAt: null,
          startedAt: null,
        },
    membershipRole: m.role,
  }));

  if (auth.role === "SUPER_ADMIN") {
    const allSites = await prisma.site.findMany({ include: { siteDomains: true } });
    const merged = new Map<string, any>();
    for (const site of [
      ...memberSites,
      ...allSites.map((s) => ({
        ...s,
        subscription: accountSub
          ? {
              plan: accountSub.plan,
              status: accountSub.status,
              expiresAt: accountSub.expiresAt,
              startedAt: accountSub.startedAt,
            }
          : ({
              plan: "FREE",
              status: "active",
              expiresAt: null,
              startedAt: null,
            } as any),
        membershipRole: SiteRole.OWNER,
      })),
    ]) {
      merged.set(site.id, site);
    }
    return res.json({ sites: Array.from(merged.values()) });
  }

  return res.json({ sites: memberSites });
}

export async function createSite(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const parsed = createSiteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  if (auth.role !== "SUPER_ADMIN") {
    const plan = await getAccountPlan(auth.adminId);
    const siteLimit = getSiteLimit(plan);
    if (siteLimit !== null) {
      const siteCount = await prisma.adminSiteMembership.count({
        where: { adminId: auth.adminId },
      });
      if (siteCount >= siteLimit) {
        return res.status(402).json({
          message: "Site limit reached. Upgrade to add more sites.",
          plans: PLANS.filter((p) => p.id !== "FREE"),
        });
      }
    }
  }

  const firstDomain =
    parsed.data.domains && parsed.data.domains.length > 0
      ? normalizeDomain(parsed.data.domains[0])
      : undefined;

  const slug = await ensureUniqueSiteSlug(parsed.data.name);
  const site = await prisma.site.create({
    data: {
      name: parsed.data.name,
      slug,
      domains: firstDomain ? [firstDomain] : [],
      defaultLocale: parsed.data.defaultLocale,
      settingsJson:
        parsed.data.settingsJson === undefined ? undefined : (parsed.data.settingsJson as Prisma.InputJsonValue),
    },
  });

  await prisma.adminSiteMembership.create({
    data: { adminId: auth.adminId, siteId: site.id, role: SiteRole.OWNER },
  });

  const adminRecord = await prisma.adminUser.findUnique({
    where: { id: auth.adminId },
    select: { primarySiteId: true },
  });
  if (!adminRecord?.primarySiteId) {
    await prisma.adminUser.update({ where: { id: auth.adminId }, data: { primarySiteId: site.id } });
  }

  // Create a domain record immediately if provided (single primary domain per site)
  if (firstDomain) {
    await prisma.siteDomain.create({
      data: {
        siteId: site.id,
        domain: firstDomain,
        verificationToken: generateDomainToken(),
        status: "PENDING",
      },
    });
  }

  res.status(201).json({ site: { ...site, membershipRole: SiteRole.OWNER } });
}

export async function listTokens(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });

  if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== SiteRole.OWNER) {
    return res.status(403).json({ message: "Only owners can view tokens" });
  }

  const tokens = await prisma.apiToken.findMany({
    where: { siteId: site.siteId },
    select: {
      id: true,
      name: true,
      plain: true,
      role: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ tokens });
}

export async function createToken(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });

  if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== SiteRole.OWNER) {
    return res.status(403).json({ message: "Only owners can create tokens" });
  }

  const parsed = createTokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const existingToken = await prisma.apiToken.findFirst({
    where: { siteId: site.siteId },
  });
  if (existingToken) {
    return res
      .status(400)
      .json({ message: "This site already has a token. Delete the existing token to create a new one." });
  }

  const plain = generatePlainToken();
  const hashed = hashToken(plain);

  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;

  const token = await prisma.apiToken.create({
    data: {
      siteId: site.siteId,
      name: parsed.data.name,
       plain: plain,
      role: parsed.data.role ?? ApiTokenRole.READ_ONLY,
      expiresAt,
      hashed,
    },
    select: {
      id: true,
      name: true,
      plain: true,
      role: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  res.status(201).json({ token, plainToken: plain });
}

export async function deleteToken(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });

  if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== SiteRole.OWNER) {
    return res.status(403).json({ message: "Only owners can delete tokens" });
  }

  const token = await prisma.apiToken.findUnique({ where: { id: req.params.tokenId } });
  if (!token || token.siteId !== site.siteId) return res.status(404).json({ message: "Not found" });

  await prisma.apiToken.delete({ where: { id: token.id } });
  res.json({ ok: true });
}

function normalizeDomain(domain: string) {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function generateDomainToken() {
  return crypto.randomBytes(16).toString("hex");
}

export async function listDomains(req: Request, res: Response) {
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });

  const domains = await prisma.siteDomain.findMany({
    where: { siteId: site.siteId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ domains });
}

export async function addDomain(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });
  if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== SiteRole.OWNER) {
    return res.status(403).json({ message: "Only owners can manage domains" });
  }

  const parsed = addDomainSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const domain = normalizeDomain(parsed.data.domain);
  // Enforce single primary domain per site
  const existingDomain = await prisma.siteDomain.findFirst({ where: { siteId: site.siteId } });
  if (existingDomain && existingDomain.domain !== domain) {
    return res.status(400).json({ message: "A site can have only one domain. Delete the current domain first." });
  }

  // Keep the same token once generated for this domain until it is deleted.
  const existing = await prisma.siteDomain.findUnique({
    where: { siteId_domain: { siteId: site.siteId, domain } },
  });

  const record =
    existing ??
    (await prisma.siteDomain.create({
      data: {
        siteId: site.siteId,
        domain,
        verificationToken: generateDomainToken(),
        status: "PENDING",
      },
    }));

  // keep domains array in sync for backwards compatibility
  await prisma.site
    .update({
      where: { id: site.siteId },
      data: {
        domains: [domain],
      },
    })
    .catch(() => {
      /* ignore array sync errors */
    });

  res.status(201).json({ domain: record });
}

export async function refreshDomainToken(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });
  if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== SiteRole.OWNER) {
    return res.status(403).json({ message: "Only owners can manage domains" });
  }

  const domain = await prisma.siteDomain.findUnique({ where: { id: req.params.domainId } });
  if (!domain || domain.siteId !== site.siteId) return res.status(404).json({ message: "Not found" });

  // Tokens stay fixed per domain; do not rotate. Return current record.
  res.json({ domain });
}

export async function verifyDomain(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });
  if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== SiteRole.OWNER) {
    return res.status(403).json({ message: "Only owners can verify domains" });
  }

  const domain = await prisma.siteDomain.findUnique({ where: { id: req.params.domainId } });
  if (!domain || domain.siteId !== site.siteId) return res.status(404).json({ message: "Not found" });

  // DNS TXT check: sapphire-site-verification=<token>
  try {
    const txtRecords = await dns.resolveTxt(domain.domain);
    const flat = txtRecords.flat().map((t) => t.toString());
    const match = flat.some((entry) => entry.includes(domain.verificationToken));

    if (!match) {
      await prisma.siteDomain.update({
        where: { id: domain.id },
        data: { status: "FAILED" },
      });
      return res.status(400).json({
        message: "Verification token not found in DNS TXT records",
        expected: `TXT sapphire-site-verification=${domain.verificationToken}`,
      });
    }
  } catch (err: any) {
    await prisma.siteDomain.update({
      where: { id: domain.id },
      data: { status: "FAILED" },
    });
    return res.status(400).json({ message: "DNS lookup failed", detail: err?.message });
  }

  const updated = await prisma.siteDomain.update({
    where: { id: domain.id },
    data: { status: "VERIFIED", verifiedAt: new Date() },
  });

  // Allow this domain (and its subdomains) via CORS without manual env edits
  try {
    const { addVerifiedDomain } = await import("../config/cors");
    addVerifiedDomain(domain.domain);
  } catch (err) {
    console.error("Failed to add verified domain to CORS allowlist", err);
  }

  res.json({ domain: updated });
}

// HTML file verification fallback: expects a file at
// https://<domain>/.well-known/sapphire-site-verification.txt
// containing the verification token.
export async function verifyDomainHtml(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });
  if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== SiteRole.OWNER) {
    return res.status(403).json({ message: "Only owners can verify domains" });
  }

  const domain = await prisma.siteDomain.findUnique({ where: { id: req.params.domainId } });
  if (!domain || domain.siteId !== site.siteId) return res.status(404).json({ message: "Not found" });

  const urls = [
    `https://${domain.domain}/.well-known/sapphire-site-verification.txt`,
    `http://${domain.domain}/.well-known/sapphire-site-verification.txt`,
  ];

  let matched = false;
  let lastError: string | null = null;

  for (const url of urls) {
    try {
      const resp = await axios.get<string>(url, { timeout: 5000 });
      const body = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
      if (body.includes(domain.verificationToken)) {
        matched = true;
        break;
      }
      lastError = `Token not found at ${url}`;
    } catch (err: any) {
      lastError = err?.message || `Request failed for ${url}`;
    }
  }

  if (!matched) {
    await prisma.siteDomain.update({
      where: { id: domain.id },
      data: { status: "FAILED" },
    });
    return res.status(400).json({
      message: lastError || "Verification token not found in HTML file",
      expectedPath: "/.well-known/sapphire-site-verification.txt",
      expectedContent: domain.verificationToken,
    });
  }

  const updated = await prisma.siteDomain.update({
    where: { id: domain.id },
    data: { status: "VERIFIED", verifiedAt: new Date() },
  });

  // Allow this domain (and its subdomains) via CORS without manual env edits
  try {
    const { addVerifiedDomain } = await import("../config/cors");
    addVerifiedDomain(domain.domain);
  } catch (err) {
    console.error("Failed to add verified domain to CORS allowlist", err);
  }

  res.json({ domain: updated });
}

export async function deleteDomain(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const site = (req as any).site as SiteContext | undefined;
  if (!site) return res.status(400).json({ message: "Site context missing" });
  if (auth.role !== "SUPER_ADMIN" && site.membershipRole !== SiteRole.OWNER) {
    return res.status(403).json({ message: "Only owners can manage domains" });
  }

  const domain = await prisma.siteDomain.findUnique({ where: { id: req.params.domainId } });
  if (!domain || domain.siteId !== site.siteId) return res.status(404).json({ message: "Not found" });

  // Sync domains array by removing the deleted domain
  const siteRecord = await prisma.site.findUnique({
    where: { id: site.siteId },
    select: { domains: true },
  });
  const currentDomains = siteRecord?.domains ?? [];
  const filteredDomains = currentDomains.filter((d) => d !== domain.domain);

  await prisma.$transaction([
    prisma.siteDomain.delete({ where: { id: domain.id } }),
    prisma.site.update({
      where: { id: site.siteId },
      data: { domains: filteredDomains },
    }),
  ]);

  return res.json({ ok: true });
}

export async function deleteSite(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const siteId = req.params.id;
  if (!siteId) return res.status(400).json({ message: "Missing site id" });

  const membership = await prisma.adminSiteMembership.findFirst({
    where: { siteId, adminId: auth.adminId },
  });
  const isSuperAdmin = auth.role === "SUPER_ADMIN";
  if (!membership && !isSuperAdmin) {
    return res.status(403).json({ message: "You do not have access to this site" });
  }
  if (!isSuperAdmin && membership?.role !== SiteRole.OWNER) {
    return res.status(403).json({ message: "Only owners can delete a site" });
  }

  const adminRecord = await prisma.adminUser.findUnique({
    where: { id: auth.adminId },
    select: { primarySiteId: true },
  });
  if (adminRecord?.primarySiteId === siteId) {
    const otherSites = await prisma.adminSiteMembership.count({
      where: { adminId: auth.adminId, siteId: { not: siteId } },
    });
    if (otherSites > 0) {
      return res.status(400).json({ message: "This is your primary site. Set another site as primary before deleting." });
    }
    return res.status(400).json({ message: "You cannot delete your only site." });
  }

  await prisma.$transaction([
    prisma.blogPostTag.deleteMany({ where: { post: { siteId } } }),
    prisma.blogPost.deleteMany({ where: { siteId } }),
    prisma.tag.deleteMany({ where: { siteId } }),
    prisma.apiToken.deleteMany({ where: { siteId } }),
    prisma.siteDomain.deleteMany({ where: { siteId } }),
    prisma.adminSiteMembership.deleteMany({ where: { siteId } }),
    prisma.site.delete({ where: { id: siteId } }),
  ]);

  return res.json({ ok: true });
}

export async function makePrimarySite(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;
  const siteId = req.params.id;
  if (!siteId) return res.status(400).json({ message: "Missing site id" });

  const membership = await prisma.adminSiteMembership.findFirst({
    where: { adminId: auth.adminId, siteId },
  });
  const isSuperAdmin = auth.role === "SUPER_ADMIN";
  if (!membership && !isSuperAdmin) return res.status(403).json({ message: "You do not have access to this site" });
  if (!isSuperAdmin && membership?.role !== SiteRole.OWNER) {
    return res.status(403).json({ message: "Only owners can set a primary site" });
  }

  await prisma.adminUser.update({ where: { id: auth.adminId }, data: { primarySiteId: siteId } });
  return res.json({ ok: true, primarySiteId: siteId });
}
