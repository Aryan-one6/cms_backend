import { Plan } from "@prisma/client";
import { prisma } from "../config/prisma";

const PLAN_RANK: Record<Plan, number> = {
  [Plan.FREE]: 0,
  [Plan.PRO]: 1,
  [Plan.ENTERPRISE]: 2,
};

function pickBestPlan(plans: Plan[]) {
  if (!plans.length) return Plan.FREE;
  return plans.reduce((best, next) => (PLAN_RANK[next] > PLAN_RANK[best] ? next : best), plans[0]);
}

export async function ensureAccountSubscription(adminId: string) {
  const existing = await prisma.accountSubscription.findUnique({
    where: { adminId },
  });
  if (existing) return existing;

  const memberships = await prisma.adminSiteMembership.findMany({
    where: { adminId },
    select: { siteId: true },
  });
  const siteIds = memberships.map((m) => m.siteId);

  let plan = Plan.FREE;
  let status = "active";
  let expiresAt: Date | null = null;
  let startedAt: Date | null = null;

  if (siteIds.length) {
    const siteSubs = await prisma.subscription.findMany({
      where: { siteId: { in: siteIds } },
      select: { plan: true, status: true, expiresAt: true, startedAt: true },
    });
    const active = siteSubs.filter((s) => s.status === "active");
    const candidates = active.length ? active : siteSubs;
    plan = pickBestPlan(candidates.map((s) => s.plan));
    const withExpiry = candidates.filter((s) => s.expiresAt);
    if (withExpiry.length) {
      expiresAt = withExpiry
        .map((s) => s.expiresAt as Date)
        .sort((a, b) => b.getTime() - a.getTime())[0];
    }
    const withStart = candidates.filter((s) => s.startedAt);
    if (withStart.length) {
      startedAt = withStart
        .map((s) => s.startedAt as Date)
        .sort((a, b) => a.getTime() - b.getTime())[0];
    }
  }

  return prisma.accountSubscription.create({
    data: {
      adminId,
      plan,
      status,
      expiresAt,
      startedAt: startedAt ?? new Date(),
    },
  });
}

export async function getAccountSubscription(adminId: string) {
  return ensureAccountSubscription(adminId);
}

export async function getAccountPlan(adminId: string) {
  const sub = await ensureAccountSubscription(adminId);
  if (sub.status !== "active") return Plan.FREE;
  return sub.plan;
}
