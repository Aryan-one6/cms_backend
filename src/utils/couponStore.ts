import fs from "fs/promises";
import path from "path";
import { v4 as uuid } from "uuid";

import { Plan } from "@prisma/client";

export type CouponRecord = {
  id: string;
  code: string;
  amountOffPaise?: number;
  percentOff?: number;
  maxRedemptions?: number | null;
  redeemed?: number;
  expiresAt?: string | null;
  validFrom?: string | null;
  applicablePlans?: Plan[] | null;
  minOrderPaise?: number | null;
  minMonths?: number | null;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  readOnly?: boolean;
};

const storePath = path.resolve(__dirname, "../data/coupons.json");

async function ensureStore() {
  const dir = path.dirname(storePath);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, "[]", "utf8");
  }
}

async function readAll(): Promise<CouponRecord[]> {
  await ensureStore();
  const raw = await fs.readFile(storePath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as CouponRecord[];
    return [];
  } catch {
    return [];
  }
}

async function writeAll(coupons: CouponRecord[]) {
  await ensureStore();
  await fs.writeFile(storePath, JSON.stringify(coupons, null, 2), "utf8");
}

export async function listCoupons() {
  const items = await readAll();
  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function findCouponByCode(code: string) {
  const items = await readAll();
  const match = items.find((c) => c.code === code.toUpperCase());
  return match || null;
}

export async function findCouponById(id: string) {
  const items = await readAll();
  return items.find((c) => c.id === id) || null;
}

export async function createCoupon(data: Omit<CouponRecord, "id" | "createdAt" | "updatedAt">) {
  const coupons = await readAll();
  const now = new Date().toISOString();
  const record: CouponRecord = {
    ...data,
    id: uuid(),
    code: data.code.toUpperCase(),
    redeemed: data.redeemed ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  coupons.push(record);
  await writeAll(coupons);
  return record;
}

export async function updateCoupon(id: string, data: Partial<CouponRecord>) {
  const coupons = await readAll();
  const idx = coupons.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  coupons[idx] = { ...coupons[idx], ...data, updatedAt: now, code: (data.code || coupons[idx].code).toUpperCase() };
  await writeAll(coupons);
  return coupons[idx];
}

export async function deleteCoupon(id: string) {
  const coupons = await readAll();
  const filtered = coupons.filter((c) => c.id !== id);
  await writeAll(filtered);
}

export async function incrementCouponRedemption(code: string) {
  const coupons = await readAll();
  const idx = coupons.findIndex((c) => c.code === code.toUpperCase());
  if (idx === -1) return;
  coupons[idx].redeemed = (coupons[idx].redeemed || 0) + 1;
  coupons[idx].updatedAt = new Date().toISOString();
  await writeAll(coupons);
}

export function isCouponValid(c: CouponRecord) {
  if (!c.active) return false;
  if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) return false;
  if (c.maxRedemptions != null && (c.redeemed || 0) >= c.maxRedemptions) return false;
  return true;
}
