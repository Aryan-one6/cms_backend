import { Plan } from "@prisma/client";

export const FREE_POST_LIMIT = 2;

export const PLANS = [
  {
    id: "FREE",
    name: "Free",
    price: 0,
    pricePaise: 0,
    description: "Get started with 2 posts per site.",
    features: ["2 posts per site", "1 site", "Community support"],
    siteLimit: 1,
    plan: Plan.FREE,
  },
  {
    id: "PRO",
    name: "Pro",
    price: 1900, // INR
    pricePaise: 1900 * 100,
    description: "Unlimited posts for growing teams.",
    features: ["Unlimited posts", "Up to 3 sites", "Image generation", "Priority support"],
    siteLimit: 3,
    plan: Plan.PRO,
  },
  {
    id: "ENTERPRISE",
    name: "Enterprise",
    price: 4900, // INR
    pricePaise: 4900 * 100,
    description: "Custom limits, SLA, and dedicated support.",
    features: ["Unlimited everything", "Unlimited sites", "Dedicated success manager"],
    siteLimit: null,
    plan: Plan.ENTERPRISE,
  },
];

export function findPlan(planId: string) {
  return PLANS.find((p) => p.id.toUpperCase() === planId.toUpperCase());
}

export function getSiteLimit(plan: Plan) {
  const entry = PLANS.find((p) => p.plan === plan);
  if (!entry) return 1;
  return entry.siteLimit;
}
