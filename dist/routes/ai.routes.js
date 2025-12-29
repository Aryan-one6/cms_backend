"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middlewares/auth");
const site_1 = require("../middlewares/site");
const ai_controller_1 = require("../controllers/ai.controller");
exports.aiRouter = (0, express_1.Router)();
exports.aiRouter.post("/admin/ai/post-draft", auth_1.requireAuth, site_1.requireSiteAccess, ai_controller_1.generatePostDraft);
