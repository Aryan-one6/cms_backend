import jwt, { type Secret, type SignOptions } from "jsonwebtoken";

export function getJwtConfig() {
  const jwtSecret = process.env.JWT_SECRET as Secret | undefined;
  if (!jwtSecret) {
    throw new Error("JWT secret is not configured");
  }
  const expiresIn: SignOptions["expiresIn"] =
    (process.env.JWT_EXPIRES_IN as SignOptions["expiresIn"]) ?? "7d";
  return { jwtSecret, expiresIn };
}

export function getCookieOptions() {
  const sameSiteEnv = (process.env.COOKIE_SAMESITE || "").toLowerCase();
  const sameSite = (sameSiteEnv === "none" ? "none" : sameSiteEnv === "lax" ? "lax" : undefined) as
    | "lax"
    | "none"
    | undefined;
  const useNone = sameSite === "none";
  return {
    httpOnly: true,
    sameSite: useNone ? "none" : "lax",
    secure: useNone || process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  } as const;
}

export function signAdminToken(payload: { adminId: string; role: string }) {
  const { jwtSecret, expiresIn } = getJwtConfig();
  return jwt.sign(payload, jwtSecret, { expiresIn });
}
