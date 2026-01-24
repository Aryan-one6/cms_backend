"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcrypt_1 = __importDefault(require("bcrypt"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const prisma_1 = require("../config/prisma");
async function main() {
    const email = process.env.SUPER_ADMIN_EMAIL || "connect@triadflair.com";
    const password = process.env.SUPER_ADMIN_PASSWORD || "Aryan@321";
    const existing = await prisma_1.prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
        console.log("Admin already exists:", email);
        return;
    }
    const passwordHash = await bcrypt_1.default.hash(password, 10);
    await prisma_1.prisma.adminUser.create({
        data: {
            name: "Super Admin",
            email,
            passwordHash,
            role: "SUPER_ADMIN",
        },
    });
    console.log("✅ Seeded admin:", { email, password });
}
main()
    .catch(console.error)
    .finally(async () => prisma_1.prisma.$disconnect());
