import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  createUser,
  deletePostSuper,
  deleteSiteSuper,
  deleteUser,
  listSubscriptions,
  getMetrics,
  listCouponsSuper,
  createCouponSuper,
  updateCouponSuper,
  deleteCouponSuper,
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
superAdminRouter.get("/users", listUsers);
superAdminRouter.post("/users", createUser);
superAdminRouter.patch("/users/:userId", updateUser);
superAdminRouter.delete("/users/:userId", deleteUser);

// Sites
superAdminRouter.get("/sites", listSites);
superAdminRouter.patch("/sites/:siteId/status", updateSiteStatus);
superAdminRouter.delete("/sites/:siteId", deleteSiteSuper);

// Posts
superAdminRouter.get("/posts", listPosts);
superAdminRouter.delete("/posts/:postId", deletePostSuper);

// Subscriptions & metrics
superAdminRouter.get("/subscriptions", listSubscriptions);
superAdminRouter.get("/metrics", getMetrics);

// Coupons (file-backed store)
superAdminRouter.get("/coupons", listCouponsSuper);
superAdminRouter.post("/coupons", createCouponSuper);
superAdminRouter.patch("/coupons/:id", updateCouponSuper);
superAdminRouter.delete("/coupons/:id", deleteCouponSuper);
