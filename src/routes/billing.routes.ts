import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { listPlans, createOrder, verifyPayment } from "../controllers/billing.controller";

export const billingRouter = Router();

billingRouter.get("/admin/billing/plans", requireAuth, listPlans);
billingRouter.post("/admin/billing/order", requireAuth, createOrder);
billingRouter.post("/admin/billing/verify", requireAuth, verifyPayment);
