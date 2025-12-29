import { VercelRequest, VercelResponse } from "@vercel/node";
import app from "../src/app";

// Express app is a request handler; just forward the request/response.
export default function handler(req: VercelRequest, res: VercelResponse) {
  return (app as any)(req, res);
}
