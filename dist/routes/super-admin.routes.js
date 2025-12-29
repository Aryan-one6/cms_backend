"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.superAdminRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middlewares/auth");
const superAdmin_controller_1 = require("../controllers/superAdmin.controller");
exports.superAdminRouter = (0, express_1.Router)();
exports.superAdminRouter.use(auth_1.requireAuth, superAdmin_controller_1.requireSuperAdmin);
// Users
exports.superAdminRouter.get("/users", superAdmin_controller_1.listUsers);
exports.superAdminRouter.post("/users", superAdmin_controller_1.createUser);
exports.superAdminRouter.patch("/users/:userId", superAdmin_controller_1.updateUser);
exports.superAdminRouter.delete("/users/:userId", superAdmin_controller_1.deleteUser);
// Sites
exports.superAdminRouter.get("/sites", superAdmin_controller_1.listSites);
exports.superAdminRouter.patch("/sites/:siteId/status", superAdmin_controller_1.updateSiteStatus);
exports.superAdminRouter.delete("/sites/:siteId", superAdmin_controller_1.deleteSiteSuper);
// Posts
exports.superAdminRouter.get("/posts", superAdmin_controller_1.listPosts);
exports.superAdminRouter.delete("/posts/:postId", superAdmin_controller_1.deletePostSuper);
