import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { requireSiteAccess } from "../middlewares/site";
import {
  createSite,
  createToken,
  deleteToken,
  listSites,
  listTokens,
  addDomain,
  listDomains,
  verifyDomain,
  verifyDomainHtml,
  refreshDomainToken,
  deleteDomain,
  deleteSite,
  makePrimarySite,
} from "../controllers/sites.controller";

export const sitesRouter = Router();

sitesRouter.get("/admin/sites", requireAuth, listSites);
sitesRouter.post("/admin/sites", requireAuth, createSite);
sitesRouter.get("/admin/sites/:id/tokens", requireAuth, requireSiteAccess, listTokens);
sitesRouter.post("/admin/sites/:id/tokens", requireAuth, requireSiteAccess, createToken);
sitesRouter.delete(
  "/admin/sites/:siteId/tokens/:tokenId",
  requireAuth,
  requireSiteAccess,
  deleteToken
);
sitesRouter.post("/admin/sites/:id/make-primary", requireAuth, requireSiteAccess, makePrimarySite);

sitesRouter.get("/admin/sites/:id/domains", requireAuth, requireSiteAccess, listDomains);
sitesRouter.post("/admin/sites/:id/domains", requireAuth, requireSiteAccess, addDomain);
sitesRouter.post(
  "/admin/sites/:id/domains/:domainId/verify",
  requireAuth,
  requireSiteAccess,
  verifyDomain
);
sitesRouter.post(
  "/admin/sites/:id/domains/:domainId/verify-html",
  requireAuth,
  requireSiteAccess,
  verifyDomainHtml
);
sitesRouter.delete(
  "/admin/sites/:id/domains/:domainId",
  requireAuth,
  requireSiteAccess,
  deleteDomain
);
sitesRouter.delete("/admin/sites/:id", requireAuth, deleteSite);
sitesRouter.post(
  "/admin/sites/:id/domains/:domainId/refresh-token",
  requireAuth,
  requireSiteAccess,
  refreshDomainToken
);
