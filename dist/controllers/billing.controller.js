"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPlans = listPlans;
exports.createOrder = createOrder;
exports.verifyPayment = verifyPayment;
const razorpay_1 = __importDefault(require("razorpay"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../config/prisma");
const plans_1 = require("../config/plans");
async function listPlans(_req, res) {
    res.json({ plans: plans_1.PLANS.filter((p) => p.id !== "FREE") });
}
async function createOrder(req, res) {
    const auth = req.auth;
    try {
        const { planId, coupon } = req.body;
        if (!planId)
            return res.status(400).json({ message: "Plan is required" });
        const plan = (0, plans_1.findPlan)(planId);
        if (!plan || plan.id === "FREE")
            return res.status(400).json({ message: "Invalid plan" });
        // Coupon shortcuts
        const couponCode = (coupon || "").toString().trim().toUpperCase();
        if (couponCode === "FREE100") {
            await prisma_1.prisma.accountSubscription.upsert({
                where: { adminId: auth.adminId },
                create: { adminId: auth.adminId, plan: plan.plan, status: "active" },
                update: { plan: plan.plan, status: "active" },
            });
            return res.json({ free: true, plan, message: "Coupon applied. Plan activated." });
        }
        const keyId = process.env.LIVE_KEY_ID;
        const keySecret = process.env.LIVE_KEY_SECRET;
        if (!keyId || !keySecret)
            return res.status(500).json({ message: "Payment keys missing" });
        const gstRate = 0.18;
        const subtotal = plan.pricePaise;
        const gst = Math.round(subtotal * gstRate);
        let total = subtotal + gst;
        if (couponCode === "ONEINR") {
            total = 100; // 1 INR in paise
        }
        const razorpay = new razorpay_1.default({ key_id: keyId, key_secret: keySecret });
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
    }
    catch (err) {
        console.error("Create order failed", err?.response?.data || err);
        res.status(500).json({ message: "Unable to create payment order", detail: err?.message });
    }
}
async function verifyPayment(req, res) {
    const auth = req.auth;
    try {
        const { orderId, paymentId, signature, planId } = req.body;
        if (!orderId || !paymentId || !signature || !planId) {
            return res.status(400).json({ message: "Missing payment details" });
        }
        const plan = (0, plans_1.findPlan)(planId);
        if (!plan || plan.id === "FREE")
            return res.status(400).json({ message: "Invalid plan" });
        const keySecret = process.env.LIVE_KEY_SECRET;
        if (!keySecret)
            return res.status(500).json({ message: "Payment keys missing" });
        const expected = crypto_1.default.createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
        if (expected !== signature) {
            return res.status(400).json({ message: "Payment verification failed" });
        }
        await prisma_1.prisma.accountSubscription.upsert({
            where: { adminId: auth.adminId },
            create: { adminId: auth.adminId, plan: plan.plan, status: "active" },
            update: { plan: plan.plan, status: "active" },
        });
        res.json({ ok: true, plan: plan.id });
    }
    catch (err) {
        console.error("Verify payment failed", err?.response?.data || err);
        res.status(500).json({ message: "Payment verification failed", detail: err?.message });
    }
}
