"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startGoogleOAuth = startGoogleOAuth;
exports.googleOAuthCallback = googleOAuthCallback;
exports.startGithubOAuth = startGithubOAuth;
exports.githubOAuthCallback = githubOAuthCallback;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const client_1 = require("@prisma/client");
const prisma_1 = require("../config/prisma");
const ensureDefaultSite_1 = require("../utils/ensureDefaultSite");
const accountSubscription_1 = require("../utils/accountSubscription");
const authTokens_1 = require("../utils/authTokens");
const STATE_COOKIE = "oauth_state";
const REDIRECT_COOKIE = "oauth_redirect";
const ORIGIN_COOKIE = "oauth_origin";
function getApiOrigin(req) {
    return process.env.API_ORIGIN || `${req.protocol}://${req.get("host")}`;
}
function normalizeOrigin(value) {
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
function sanitizeRedirect(input) {
    if (!input)
        return "/";
    if (input.startsWith("/"))
        return input;
    return "/";
}
function sanitizeOrigin(input) {
    if (!input)
        return null;
    try {
        const url = new URL(input);
        const host = url.hostname.toLowerCase();
        if (host === "localhost" || host === "127.0.0.1") {
            return url.origin;
        }
        const allowedOrigins = getAppOrigins();
        if (allowedOrigins.some((origin) => origin === url.origin))
            return url.origin;
    }
    catch {
        return null;
    }
    return null;
}
function setOAuthCookies(res, state, redirectPath, origin) {
    const opts = (0, authTokens_1.getCookieOptions)();
    res.cookie(STATE_COOKIE, state, { ...opts, maxAge: 10 * 60 * 1000 });
    res.cookie(REDIRECT_COOKIE, redirectPath, { ...opts, maxAge: 10 * 60 * 1000 });
    if (origin) {
        res.cookie(ORIGIN_COOKIE, origin, { ...opts, maxAge: 10 * 60 * 1000 });
    }
}
function clearOAuthCookies(res) {
    const opts = (0, authTokens_1.getCookieOptions)();
    res.clearCookie(STATE_COOKIE, opts);
    res.clearCookie(REDIRECT_COOKIE, opts);
    res.clearCookie(ORIGIN_COOKIE, opts);
}
async function upsertOAuthAdmin(params) {
    const { provider, subject, email, name, avatarUrl } = params;
    let admin = await prisma_1.prisma.adminUser.findFirst({
        where: { oauthProvider: provider, oauthSubject: subject },
    });
    if (admin) {
        return prisma_1.prisma.adminUser.update({
            where: { id: admin.id },
            data: {
                name: admin.name || name,
                avatarUrl: avatarUrl ?? admin.avatarUrl,
            },
        });
    }
    admin = await prisma_1.prisma.adminUser.findUnique({ where: { email } });
    if (admin) {
        if (admin.oauthProvider && admin.oauthProvider !== provider) {
            throw new Error("Account already linked to another provider.");
        }
        return prisma_1.prisma.adminUser.update({
            where: { id: admin.id },
            data: {
                oauthProvider: provider,
                oauthSubject: subject,
                avatarUrl: avatarUrl ?? admin.avatarUrl,
            },
        });
    }
    return prisma_1.prisma.adminUser.create({
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
function redirectToApp(res, path, origin) {
    const appOrigin = origin || getAppOrigin();
    res.redirect(`${appOrigin}${path}`);
}
async function startGoogleOAuth(req, res) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        return res.status(500).json({ message: "Google OAuth is not configured" });
    }
    const state = crypto_1.default.randomBytes(16).toString("hex");
    const redirectPath = sanitizeRedirect(req.query.redirect || "/");
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
async function googleOAuthCallback(req, res) {
    const code = req.query.code?.toString();
    const state = req.query.state?.toString();
    const cookieState = req.cookies?.[STATE_COOKIE];
    const redirectPath = sanitizeRedirect(req.cookies?.[REDIRECT_COOKIE]);
    const origin = sanitizeOrigin(req.cookies?.[ORIGIN_COOKIE]);
    if (!code || !state || !cookieState || state !== cookieState) {
        clearOAuthCookies(res);
        return redirectToApp(res, "/login?oauth=error", origin);
    }
    try {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        const redirectUri = `${getApiOrigin(req)}/api/auth/oauth/google/callback`;
        const tokenRes = await axios_1.default.post("https://oauth2.googleapis.com/token", new URLSearchParams({
            code,
            client_id: clientId || "",
            client_secret: clientSecret || "",
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
        }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        const accessToken = tokenRes.data.access_token;
        const userRes = await axios_1.default.get("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const { sub, email, name, picture } = userRes.data || {};
        if (!sub || !email) {
            throw new Error("Google account did not return email");
        }
        const admin = await upsertOAuthAdmin({
            provider: client_1.OAuthProvider.GOOGLE,
            subject: sub,
            email,
            name: name || email.split("@")[0],
            avatarUrl: picture,
        });
        await (0, ensureDefaultSite_1.ensureDefaultSite)(admin.id, admin.name);
        await (0, accountSubscription_1.ensureAccountSubscription)(admin.id);
        const token = (0, authTokens_1.signAdminToken)({ adminId: admin.id, role: admin.role });
        res.cookie("accessToken", token, (0, authTokens_1.getCookieOptions)());
        clearOAuthCookies(res);
        return redirectToApp(res, redirectPath, origin);
    }
    catch (err) {
        console.error("Google OAuth error", err);
        clearOAuthCookies(res);
        return redirectToApp(res, "/login?oauth=error", origin);
    }
}
async function startGithubOAuth(req, res) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        return res.status(500).json({ message: "GitHub OAuth is not configured" });
    }
    const state = crypto_1.default.randomBytes(16).toString("hex");
    const redirectPath = sanitizeRedirect(req.query.redirect || "/");
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
async function githubOAuthCallback(req, res) {
    const code = req.query.code?.toString();
    const state = req.query.state?.toString();
    const cookieState = req.cookies?.[STATE_COOKIE];
    const redirectPath = sanitizeRedirect(req.cookies?.[REDIRECT_COOKIE]);
    const origin = sanitizeOrigin(req.cookies?.[ORIGIN_COOKIE]);
    if (!code || !state || !cookieState || state !== cookieState) {
        clearOAuthCookies(res);
        return redirectToApp(res, "/login?oauth=error", origin);
    }
    try {
        const clientId = process.env.GITHUB_CLIENT_ID;
        const clientSecret = process.env.GITHUB_CLIENT_SECRET;
        const redirectUri = `${getApiOrigin(req)}/api/auth/oauth/github/callback`;
        const tokenRes = await axios_1.default.post("https://github.com/login/oauth/access_token", new URLSearchParams({
            client_id: clientId || "",
            client_secret: clientSecret || "",
            code,
            redirect_uri: redirectUri,
            state,
        }), { headers: { Accept: "application/json" } });
        const accessToken = tokenRes.data.access_token;
        if (!accessToken) {
            throw new Error("GitHub access token missing");
        }
        const userRes = await axios_1.default.get("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "User-Agent": "sapphire-cms",
            },
        });
        const emailRes = await axios_1.default.get("https://api.github.com/user/emails", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "User-Agent": "sapphire-cms",
            },
        });
        const emails = emailRes.data || [];
        const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.primary) || emails[0];
        const email = primary?.email;
        const { id, name, login, avatar_url } = userRes.data || {};
        if (!id || !email) {
            throw new Error("GitHub account did not return email");
        }
        const admin = await upsertOAuthAdmin({
            provider: client_1.OAuthProvider.GITHUB,
            subject: String(id),
            email,
            name: name || login || email.split("@")[0],
            avatarUrl: avatar_url,
        });
        await (0, ensureDefaultSite_1.ensureDefaultSite)(admin.id, admin.name);
        await (0, accountSubscription_1.ensureAccountSubscription)(admin.id);
        const token = (0, authTokens_1.signAdminToken)({ adminId: admin.id, role: admin.role });
        res.cookie("accessToken", token, (0, authTokens_1.getCookieOptions)());
        clearOAuthCookies(res);
        return redirectToApp(res, redirectPath, origin);
    }
    catch (err) {
        console.error("GitHub OAuth error", err);
        clearOAuthCookies(res);
        return redirectToApp(res, "/login?oauth=error", origin);
    }
}
