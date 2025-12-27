import { Router } from "express";
import { authRouter } from "./auth.routes";
import { postsRouter } from "./posts.routes";
import { uploadRouter } from "./upload.routes";
import { sitesRouter } from "./sites.routes";
import { superAdminRouter } from "./super-admin.routes";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/", postsRouter);
apiRouter.use("/", uploadRouter);
apiRouter.use("/", sitesRouter);
apiRouter.use("/", superAdminRouter);
