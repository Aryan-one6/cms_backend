"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAccountSubscription = ensureAccountSubscription;
exports.getAccountSubscription = getAccountSubscription;
exports.getAccountPlan = getAccountPlan;
const client_1 = require("@prisma/client");
const prisma_1 = require("../config/prisma");
const PLAN_RANK = {
    [client_1.Plan.FREE]: 0,
    [client_1.Plan.PRO]: 1,
    [client_1.Plan.ENTERPRISE]: 2,
};
function pickBestPlan(plans) {
    if (!plans.length)
        return client_1.Plan.FREE;
    return plans.reduce((best, next) => (PLAN_RANK[next] > PLAN_RANK[best] ? next : best), plans[0]);
}
async function ensureAccountSubscription(adminId) {
    const existing = await prisma_1.prisma.accountSubscription.findUnique({
        where: { adminId },
    });
    if (existing)
        return existing;
    const memberships = await prisma_1.prisma.adminSiteMembership.findMany({
        where: { adminId },
        select: { siteId: true },
    });
    const siteIds = memberships.map((m) => m.siteId);
    let plan = client_1.Plan.FREE;
    let status = "active";
    let expiresAt = null;
    let startedAt = null;
    if (siteIds.length) {
        const siteSubs = await prisma_1.prisma.subscription.findMany({
            where: { siteId: { in: siteIds } },
            select: { plan: true, status: true, expiresAt: true, startedAt: true },
        });
        const active = siteSubs.filter((s) => s.status === "active");
        const candidates = active.length ? active : siteSubs;
        plan = pickBestPlan(candidates.map((s) => s.plan));
        const withExpiry = candidates.filter((s) => s.expiresAt);
        if (withExpiry.length) {
            expiresAt = withExpiry
                .map((s) => s.expiresAt)
                .sort((a, b) => b.getTime() - a.getTime())[0];
        }
        const withStart = candidates.filter((s) => s.startedAt);
        if (withStart.length) {
            startedAt = withStart
                .map((s) => s.startedAt)
                .sort((a, b) => a.getTime() - b.getTime())[0];
        }
    }
    return prisma_1.prisma.accountSubscription.create({
        data: {
            adminId,
            plan,
            status,
            expiresAt,
            startedAt: startedAt ?? new Date(),
        },
    });
}
async function getAccountSubscription(adminId) {
    return ensureAccountSubscription(adminId);
}
async function getAccountPlan(adminId) {
    const sub = await ensureAccountSubscription(adminId);
    if (sub.status !== "active")
        return client_1.Plan.FREE;
    return sub.plan;
}
