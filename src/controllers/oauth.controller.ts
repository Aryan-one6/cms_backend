import { Request, Response } from "express";
import axios from "axios";
import crypto from "crypto";
import { OAuthProvider } from "@prisma/client";
import { prisma } from "../config/prisma";
import { ensureDefaultSite } from "../utils/ensureDefaultSite";
import { ensureAccountSubscription } from "../utils/accountSubscription";
import { getCookieOptions, signAdminToken } from "../utils/authTokens";

const STATE_COOKIE = "oauth_state";
const REDIRECT_COOKIE = "oauth_redirect";
const ORIGIN_COOKIE = "oauth_origin";

function getApiOrigin(req: Request) {
  return process.env.API_ORIGIN || `${req.protocol}://${req.get("host")}`;
}

function normalizeOrigin(value: string) {
  return value.replace(/\/+$/, "");
}

function getAppOrigins() {
  const raw = process.env.APP_ORIGIN || "http://localhost:5173";
  return raw
    .split(",")
    .map((entry) => normalizeOrigin(entry.trim()))
    .filter(Boolean);
}

function getAppOrigin() {
  return getAppOrigins()[0] || "http://localhost:5173";
}

function sanitizeRedirect(input?: string) {
  if (!input) return "/";
  if (input.startsWith("/")) return input;
  return "/";
}

function sanitizeOrigin(input?: string) {
  if (!input) return null;
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      return url.origin;
    }
    const allowedOrigins = getAppOrigins();
    if (allowedOrigins.some((origin) => origin === url.origin)) return url.origin;
  } catch {
    return null;
  }
  return null;
}

function setOAuthCookies(res: Response, state: string, redirectPath: string, origin?: string | null) {
  const opts = getCookieOptions();
  res.cookie(STATE_COOKIE, state, { ...opts, maxAge: 10 * 60 * 1000 });
  res.cookie(REDIRECT_COOKIE, redirectPath, { ...opts, maxAge: 10 * 60 * 1000 });
  if (origin) {
    res.cookie(ORIGIN_COOKIE, origin, { ...opts, maxAge: 10 * 60 * 1000 });
  }
}

function clearOAuthCookies(res: Response) {
  const opts = getCookieOptions();
  res.clearCookie(STATE_COOKIE, opts);
  res.clearCookie(REDIRECT_COOKIE, opts);
  res.clearCookie(ORIGIN_COOKIE, opts);
}

async function upsertOAuthAdmin(params: {
  provider: OAuthProvider;
  subject: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}) {
  const { provider, subject, email, name, avatarUrl } = params;

  let admin = await prisma.adminUser.findFirst({
    where: { oauthProvider: provider, oauthSubject: subject },
  });

  if (admin) {
    return prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        name: admin.name || name,
        avatarUrl: avatarUrl ?? admin.avatarUrl,
      },
    });
  }

  admin = await prisma.adminUser.findUnique({ where: { email } });
  if (admin) {
    if (admin.oauthProvider && admin.oauthProvider !== provider) {
      throw new Error("Account already linked to another provider.");
    }
    return prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        oauthProvider: provider,
        oauthSubject: subject,
        avatarUrl: avatarUrl ?? admin.avatarUrl,
      },
    });
  }

  return prisma.adminUser.create({
    data: {
      name: name || email.split("@")[0],
      email,
      role: "EDITOR",
      oauthProvider: provider,
      oauthSubject: subject,
      avatarUrl: avatarUrl ?? null,
    },
  });
}

function redirectToApp(res: Response, path: string, origin?: string | null) {
  const appOrigin = origin || getAppOrigin();
  res.redirect(`${appOrigin}${path}`);
}

export async function startGoogleOAuth(req: Request, res: Response) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ message: "Google OAuth is not configured" });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectPath = sanitizeRedirect((req.query.redirect as string | undefined) || "/");
  const origin = sanitizeOrigin(req.get("origin") || undefined);
  setOAuthCookies(res, state, redirectPath, origin);

  const redirectUri = `${getApiOrigin(req)}/api/auth/oauth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

export async function googleOAuthCallback(req: Request, res: Response) {
  const code = req.query.code?.toString();
  const state = req.query.state?.toString();
  const cookieState = req.cookies?.[STATE_COOKIE] as string | undefined;
  const redirectPath = sanitizeRedirect(req.cookies?.[REDIRECT_COOKIE] as string | undefined);
  const origin = sanitizeOrigin(req.cookies?.[ORIGIN_COOKIE] as string | undefined);

  if (!code || !state || !cookieState || state !== cookieState) {
    clearOAuthCookies(res);
    return redirectToApp(res, "/login?oauth=error", origin);
  }

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = `${getApiOrigin(req)}/api/auth/oauth/google/callback`;

    const tokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: clientId || "",
        client_secret: clientSecret || "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenRes.data.access_token;
    const userRes = await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const { sub, email, name, picture } = userRes.data || {};
    if (!sub || !email) {
      throw new Error("Google account did not return email");
    }

    const admin = await upsertOAuthAdmin({
      provider: OAuthProvider.GOOGLE,
      subject: sub,
      email,
      name: name || email.split("@")[0],
      avatarUrl: picture,
    });

    await ensureDefaultSite(admin.id, admin.name);
    await ensureAccountSubscription(admin.id);

    const token = signAdminToken({ adminId: admin.id, role: admin.role });
    res.cookie("accessToken", token, getCookieOptions());
    clearOAuthCookies(res);
    return redirectToApp(res, redirectPath, origin);
  } catch (err) {
    console.error("Google OAuth error", err);
    clearOAuthCookies(res);
    return redirectToApp(res, "/login?oauth=error", origin);
  }
}

export async function startGithubOAuth(req: Request, res: Response) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ message: "GitHub OAuth is not configured" });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectPath = sanitizeRedirect((req.query.redirect as string | undefined) || "/");
  const origin = sanitizeOrigin(req.get("origin") || undefined);
  setOAuthCookies(res, state, redirectPath, origin);

  const redirectUri = `${getApiOrigin(req)}/api/auth/oauth/github/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state,
    allow_signup: "true",
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
}

export async function githubOAuthCallback(req: Request, res: Response) {
  const code = req.query.code?.toString();
  const state = req.query.state?.toString();
  const cookieState = req.cookies?.[STATE_COOKIE] as string | undefined;
  const redirectPath = sanitizeRedirect(req.cookies?.[REDIRECT_COOKIE] as string | undefined);
  const origin = sanitizeOrigin(req.cookies?.[ORIGIN_COOKIE] as string | undefined);

  if (!code || !state || !cookieState || state !== cookieState) {
    clearOAuthCookies(res);
    return redirectToApp(res, "/login?oauth=error", origin);
  }

  try {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const redirectUri = `${getApiOrigin(req)}/api/auth/oauth/github/callback`;

    const tokenRes = await axios.post(
      "https://github.com/login/oauth/access_token",
      new URLSearchParams({
        client_id: clientId || "",
        client_secret: clientSecret || "",
        code,
        redirect_uri: redirectUri,
        state,
      }),
      { headers: { Accept: "application/json" } }
    );

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) {
      throw new Error("GitHub access token missing");
    }

    const userRes = await axios.get("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "sapphire-cms",
      },
    });

    const emailRes = await axios.get("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "sapphire-cms",
      },
    });

    const emails: Array<{ email: string; primary: boolean; verified: boolean }> = emailRes.data || [];
    const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.primary) || emails[0];
    const email = primary?.email;

    const { id, name, login, avatar_url } = userRes.data || {};
    if (!id || !email) {
      throw new Error("GitHub account did not return email");
    }

    const admin = await upsertOAuthAdmin({
      provider: OAuthProvider.GITHUB,
      subject: String(id),
      email,
      name: name || login || email.split("@")[0],
      avatarUrl: avatar_url,
    });

    await ensureDefaultSite(admin.id, admin.name);
    await ensureAccountSubscription(admin.id);

    const token = signAdminToken({ adminId: admin.id, role: admin.role });
    res.cookie("accessToken", token, getCookieOptions());
    clearOAuthCookies(res);
    return redirectToApp(res, redirectPath, origin);
  } catch (err) {
    console.error("GitHub OAuth error", err);
    clearOAuthCookies(res);
    return redirectToApp(res, "/login?oauth=error", origin);
  }
}
