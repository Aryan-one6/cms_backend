"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getJwtConfig = getJwtConfig;
exports.getCookieOptions = getCookieOptions;
exports.signAdminToken = signAdminToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function getJwtConfig() {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        throw new Error("JWT secret is not configured");
    }
    const expiresIn = process.env.JWT_EXPIRES_IN ?? "7d";
    return { jwtSecret, expiresIn };
}
function getCookieOptions() {
    const sameSiteEnv = (process.env.COOKIE_SAMESITE || "").toLowerCase();
    const sameSite = (sameSiteEnv === "none" ? "none" : sameSiteEnv === "lax" ? "lax" : undefined);
    const useNone = sameSite === "none";
    return {
        httpOnly: true,
        sameSite: useNone ? "none" : "lax",
        secure: useNone || process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
    };
}
function signAdminToken(payload) {
    const { jwtSecret, expiresIn } = getJwtConfig();
    return jsonwebtoken_1.default.sign(payload, jwtSecret, { expiresIn });
}
