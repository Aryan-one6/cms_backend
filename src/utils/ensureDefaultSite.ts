import slugify from "slugify";
import { prisma } from "../config/prisma";
import { SiteRole } from "@prisma/client";
import { ensureAccountSubscription } from "./accountSubscription";

export async function ensureDefaultSite(adminId: string, adminName: string) {
  const existingSite = await prisma.adminSiteMembership.findFirst({ where: { adminId } });
  if (existingSite) {
    const admin = await prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { primarySiteId: true },
    });
    if (!admin?.primarySiteId) {
      await prisma.adminUser.update({ where: { id: adminId }, data: { primarySiteId: existingSite.siteId } });
    }
    await ensureAccountSubscription(adminId);
    return;
  }

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
  await prisma.adminUser.update({ where: { id: adminId }, data: { primarySiteId: site.id } });
  await ensureAccountSubscription(adminId);
}
