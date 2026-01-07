import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { requireSiteAccess } from "../middlewares/site";
import { generatePostDraft } from "../controllers/content.controller";
import { generateCoverImage } from "../controllers/image.controller";

export const aiRouter = Router();

aiRouter.post("/admin/ai/post-draft", requireAuth, requireSiteAccess, generatePostDraft);
aiRouter.post("/admin/ai/cover-image", requireAuth, requireSiteAccess, generateCoverImage);
