import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  createUser,
  deletePostSuper,
  deleteSiteSuper,
  deleteUser,
  listPosts,
  listSites,
  listUsers,
  requireSuperAdmin,
  updateSiteStatus,
  updateUser,
} from "../controllers/superAdmin.controller";

export const superAdminRouter = Router();

superAdminRouter.use(requireAuth, requireSuperAdmin);

// Users
superAdminRouter.get("/super-admin/users", listUsers);
superAdminRouter.post("/super-admin/users", createUser);
superAdminRouter.patch("/super-admin/users/:userId", updateUser);
superAdminRouter.delete("/super-admin/users/:userId", deleteUser);

// Sites
superAdminRouter.get("/super-admin/sites", listSites);
superAdminRouter.patch("/super-admin/sites/:siteId/status", updateSiteStatus);
superAdminRouter.delete("/super-admin/sites/:siteId", deleteSiteSuper);

// Posts
superAdminRouter.get("/super-admin/posts", listPosts);
superAdminRouter.delete("/super-admin/posts/:postId", deletePostSuper);
