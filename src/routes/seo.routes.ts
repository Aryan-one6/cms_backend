import { Router } from "express";
import { analyzeContent, suggestSeo, triggerSerpAnalysis } from "../controllers/seo.controller";
import { requireAuth } from "../middlewares/auth";
import { requireSiteAccess } from "../middlewares/site";

export const seoRouter = Router();

seoRouter.post("/admin/seo/serp/analyze", requireAuth, requireSiteAccess, triggerSerpAnalysis);
seoRouter.post("/admin/seo/content/analyze", requireAuth, requireSiteAccess, analyzeContent);
seoRouter.post("/admin/seo/ai/suggest", requireAuth, requireSiteAccess, suggestSeo);
