import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { requireSiteAccess } from "../middlewares/site";
import { generatePostDraft } from "../controllers/ai.controller";

export const aiRouter = Router();

aiRouter.post("/admin/ai/post-draft", requireAuth, requireSiteAccess, generatePostDraft);
