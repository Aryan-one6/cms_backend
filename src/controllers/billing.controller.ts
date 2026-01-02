import { Request, Response } from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import { prisma } from "../config/prisma";
import { findPlan, PLANS } from "../config/plans";
import { JwtPayload } from "../middlewares/auth";

export async function listPlans(_req: Request, res: Response) {
  res.json({ plans: PLANS.filter((p) => p.id !== "FREE") });
}

export async function createOrder(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;

  try {
    const { planId, coupon } = req.body as { planId?: string; coupon?: string };
    if (!planId) return res.status(400).json({ message: "Plan is required" });
    const plan = findPlan(planId);
    if (!plan || plan.id === "FREE") return res.status(400).json({ message: "Invalid plan" });

    // Coupon shortcuts
    const couponCode = (coupon || "").toString().trim().toUpperCase();
    if (couponCode === "FREE100") {
      await prisma.accountSubscription.upsert({
        where: { adminId: auth.adminId },
        create: { adminId: auth.adminId, plan: plan.plan, status: "active" },
        update: { plan: plan.plan, status: "active" },
      });
      return res.json({ free: true, plan, message: "Coupon applied. Plan activated." });
    }

    const keyId = process.env.LIVE_KEY_ID;
    const keySecret = process.env.LIVE_KEY_SECRET;
    if (!keyId || !keySecret) return res.status(500).json({ message: "Payment keys missing" });

    const gstRate = 0.18;
    const subtotal = plan.pricePaise;
    const gst = Math.round(subtotal * gstRate);
    let total = subtotal + gst;

    if (couponCode === "ONEINR") {
      total = 100; // 1 INR in paise
    }

    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const shortAdmin = auth.adminId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
    const receipt = `sub_${shortAdmin}_${Date.now().toString().slice(-6)}`.slice(0, 40);
    const order = await razorpay.orders.create({
      amount: total,
      currency: "INR",
      receipt,
      notes: { plan: plan.id, adminId: auth.adminId, gst: gst.toString() },
    });

    res.json({
      order,
      keyId,
      plan: { ...plan, gst, total },
    });
  } catch (err: any) {
    console.error("Create order failed", err?.response?.data || err);
    res.status(500).json({ message: "Unable to create payment order", detail: err?.message });
  }
}

export async function verifyPayment(req: Request, res: Response) {
  const auth = (req as any).auth as JwtPayload;

  try {
    const { orderId, paymentId, signature, planId } = req.body as {
      orderId?: string;
      paymentId?: string;
      signature?: string;
      planId?: string;
    };
    if (!orderId || !paymentId || !signature || !planId) {
      return res.status(400).json({ message: "Missing payment details" });
    }
    const plan = findPlan(planId);
    if (!plan || plan.id === "FREE") return res.status(400).json({ message: "Invalid plan" });

    const keySecret = process.env.LIVE_KEY_SECRET;
    if (!keySecret) return res.status(500).json({ message: "Payment keys missing" });

    const expected = crypto.createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
    if (expected !== signature) {
      return res.status(400).json({ message: "Payment verification failed" });
    }

    await prisma.accountSubscription.upsert({
      where: { adminId: auth.adminId },
      create: { adminId: auth.adminId, plan: plan.plan, status: "active" },
      update: { plan: plan.plan, status: "active" },
    });

    res.json({ ok: true, plan: plan.id });
  } catch (err: any) {
    console.error("Verify payment failed", err?.response?.data || err);
    res.status(500).json({ message: "Payment verification failed", detail: err?.message });
  }
}
