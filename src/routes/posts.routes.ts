import { Router, text } from "express";
import { requireAuth } from "../middlewares/auth";
import { requirePublicSiteToken, requireSiteAccess } from "../middlewares/site";
import {
  adminCreatePost,
  adminDeletePost,
  adminGetPost,
  adminListPosts,
  adminUpdatePost,
  adminDashboard,
  publicGetPostBySlug,
  publicListPosts,
  publishPost,
  unpublishPost,
  adminExportPosts,
  adminImportPosts,
} from "../controllers/posts.controller";

export const postsRouter = Router();

// public
postsRouter.get("/public/posts", requirePublicSiteToken, publicListPosts);
postsRouter.get("/public/posts/:slug", requirePublicSiteToken, publicGetPostBySlug);

// admin
postsRouter.get("/admin/dashboard", requireAuth, requireSiteAccess, adminDashboard);
postsRouter.get("/admin/posts", requireAuth, requireSiteAccess, adminListPosts);
postsRouter.get("/admin/posts/export", requireAuth, requireSiteAccess, adminExportPosts);
postsRouter.get("/admin/posts/:id", requireAuth, requireSiteAccess, adminGetPost);
postsRouter.post("/admin/posts", requireAuth, requireSiteAccess, adminCreatePost);
postsRouter.put("/admin/posts/:id", requireAuth, requireSiteAccess, adminUpdatePost);
postsRouter.delete("/admin/posts/:id", requireAuth, requireSiteAccess, adminDeletePost);
postsRouter.post("/admin/posts/:id/publish", requireAuth, requireSiteAccess, publishPost);
postsRouter.post("/admin/posts/:id/unpublish", requireAuth, requireSiteAccess, unpublishPost);
postsRouter.post(
  "/admin/posts/import",
  requireAuth,
  requireSiteAccess,
  text({ type: ["text/csv", "text/plain"] }),
  adminImportPosts
);
