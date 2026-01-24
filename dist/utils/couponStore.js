"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCoupons = listCoupons;
exports.findCouponByCode = findCouponByCode;
exports.findCouponById = findCouponById;
exports.createCoupon = createCoupon;
exports.updateCoupon = updateCoupon;
exports.deleteCoupon = deleteCoupon;
exports.incrementCouponRedemption = incrementCouponRedemption;
exports.isCouponValid = isCouponValid;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const storePath = path_1.default.resolve(__dirname, "../data/coupons.json");
async function ensureStore() {
    const dir = path_1.default.dirname(storePath);
    await promises_1.default.mkdir(dir, { recursive: true });
    try {
        await promises_1.default.access(storePath);
    }
    catch {
        await promises_1.default.writeFile(storePath, "[]", "utf8");
    }
}
async function readAll() {
    await ensureStore();
    const raw = await promises_1.default.readFile(storePath, "utf8");
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
            return parsed;
        return [];
    }
    catch {
        return [];
    }
}
async function writeAll(coupons) {
    await ensureStore();
    await promises_1.default.writeFile(storePath, JSON.stringify(coupons, null, 2), "utf8");
}
async function listCoupons() {
    const items = await readAll();
    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
async function findCouponByCode(code) {
    const items = await readAll();
    const match = items.find((c) => c.code === code.toUpperCase());
    return match || null;
}
async function findCouponById(id) {
    const items = await readAll();
    return items.find((c) => c.id === id) || null;
}
async function createCoupon(data) {
    const coupons = await readAll();
    const now = new Date().toISOString();
    const record = {
        ...data,
        id: (0, uuid_1.v4)(),
        code: data.code.toUpperCase(),
        redeemed: data.redeemed ?? 0,
        createdAt: now,
        updatedAt: now,
    };
    coupons.push(record);
    await writeAll(coupons);
    return record;
}
async function updateCoupon(id, data) {
    const coupons = await readAll();
    const idx = coupons.findIndex((c) => c.id === id);
    if (idx === -1)
        return null;
    const now = new Date().toISOString();
    coupons[idx] = { ...coupons[idx], ...data, updatedAt: now, code: (data.code || coupons[idx].code).toUpperCase() };
    await writeAll(coupons);
    return coupons[idx];
}
async function deleteCoupon(id) {
    const coupons = await readAll();
    const filtered = coupons.filter((c) => c.id !== id);
    await writeAll(filtered);
}
async function incrementCouponRedemption(code) {
    const coupons = await readAll();
    const idx = coupons.findIndex((c) => c.code === code.toUpperCase());
    if (idx === -1)
        return;
    coupons[idx].redeemed = (coupons[idx].redeemed || 0) + 1;
    coupons[idx].updatedAt = new Date().toISOString();
    await writeAll(coupons);
}
function isCouponValid(c) {
    if (!c.active)
        return false;
    if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now())
        return false;
    if (c.maxRedemptions != null && (c.redeemed || 0) >= c.maxRedemptions)
        return false;
    return true;
}
