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
    id: "STARTER",
    name: "Starter",
    price: 299,
    pricePaise: 299 * 100,
    description: "For bloggers & small businesses",
    features: [
      "1 website",
      "Up to 15 blog posts/month",
      "AI content generation (limited tokens)",
      "AI image generation (10 images/month)",
      "Draft + Publish",
      "SEO title & meta description",
      "Email support",
    ],
    siteLimit: 1,
    plan: Plan.STARTER,
    highlight: "Impulse buy; cheaper than one coffee per week",
  },
  {
    id: "GROWTH",
    name: "Growth",
    price: 999,
    pricePaise: 999 * 100,
    description: "For agencies & growing brands",
    features: [
      "Up to 3 websites",
      "Unlimited blog posts (fair usage)",
      "AI content generation (fair usage)",
      "AI image generation (50 images/month)",
      "Content templates",
      "Tags & categories",
      "Priority support",
      "Team access (2 users)",
    ],
    siteLimit: 3,
    plan: Plan.GROWTH,
    highlight: "Most popular; professional price point",
  },
  {
    id: "PRO",
    name: "Pro",
    price: 1999,
    pricePaise: 1999 * 100,
    description: "For serious content teams",
    features: [
      "Up to 10 websites",
      "Unlimited posts",
      "Higher AI limits",
      "Image generation (200 images/month)",
      "Custom brand tone (AI training)",
      "Analytics (views, performance)",
      "API access",
      "Team access (5 users)",
    ],
    siteLimit: 10,
    plan: Plan.PRO,
    highlight: "Scale content ops with advanced controls",
  },
  {
    id: "ENTERPRISE",
    name: "Enterprise",
    price: 0,
    pricePaise: 0,
    description: "Custom limits, SLA, and dedicated support.",
    features: [
      "Unlimited sites",
      "Unlimited AI (fair usage)",
      "Custom workflows",
      "Dedicated account manager",
      "SLA & uptime guarantee",
      "On-prem / private deployment (optional)",
    ],
    siteLimit: null,
    plan: Plan.ENTERPRISE,
    highlight: "Contact Sales for tailored pricing",
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
