"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const bcrypt_1 = __importDefault(require("bcrypt"));
const prisma_1 = require("../config/prisma");
async function run() {
    const email = "connect@triadflair.com";
    const password = "Admin@12345";
    const passwordHash = await bcrypt_1.default.hash(password, 10);
    const user = await prisma_1.prisma.adminUser.upsert({
        where: { email },
        // Casts are used to avoid stale client typings when status enum was recently added.
        update: { passwordHash, role: "SUPER_ADMIN", status: "ACTIVE" },
        create: { name: "Super Admin", email, passwordHash, role: "SUPER_ADMIN", status: "ACTIVE" },
    });
    console.log("Upserted super admin", { email: user.email, role: user.role, status: user.status });
}
run()
    .catch((err) => {
    console.error(err);
})
    .finally(async () => {
    await prisma_1.prisma.$disconnect();
});
