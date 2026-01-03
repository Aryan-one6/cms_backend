import { Router } from "express";
import {
  login,
  logout,
  me,
  signup,
  requestPasswordReset,
  confirmPasswordReset,
  setPassword,
} from "../controllers/auth.controller";
import {
  startGoogleOAuth,
  googleOAuthCallback,
  startGithubOAuth,
  githubOAuthCallback,
} from "../controllers/oauth.controller";
import { requireAuth } from "../middlewares/auth";

export const authRouter = Router();

authRouter.post("/login", login);
authRouter.post("/signup", signup);
authRouter.post("/password-reset/request", requestPasswordReset);
authRouter.post("/password-reset/confirm", confirmPasswordReset);
authRouter.post("/password/set", requireAuth, setPassword);
authRouter.get("/me", requireAuth, me);
authRouter.post("/logout", logout);
authRouter.get("/oauth/google", startGoogleOAuth);
authRouter.get("/oauth/google/callback", googleOAuthCallback);
authRouter.get("/oauth/github", startGithubOAuth);
authRouter.get("/oauth/github/callback", githubOAuthCallback);
