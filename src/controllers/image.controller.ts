import { Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { uploadToS3, buildUploadKey } from "../config/storage";
import { prisma } from "../config/prisma";

const defaultImageModel = "imagen-4.0-fast-generate-001";

const imageSchema = z.object({
  prompt: z.string().min(4, "Prompt is required"),
  postId: z.string().optional(),
});

export async function generateCoverImage(req: Request, res: Response) {
  const parsed = imageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Prompt is required" });

  const apiKey = process.env.GEMINI_API_KEY || process.env.VERTEX_AI;
  if (!apiKey) return res.status(500).json({ message: "Missing API key" });

  const preferredApiVersion = process.env.GOOGLE_API_VERSION?.trim();
  const apiVersions = [preferredApiVersion, "v1beta", "v1"].filter(
    (v, idx, arr): v is string => Boolean(v) && arr.indexOf(v) === idx
  );

  const imagePrompt = `Create a cinematic, editorial-quality hero image for a blog post about "${parsed.data.prompt}". 
- Style: natural light, shallow depth of field, clean composition, no text or logos.
- Subject: focus on a real-world scene that visually conveys the topic without showing generic stock clichés.
- Output: photo-realistic, 16:9 aspect ratio, high resolution, balanced contrast, zero watermarks.`;

  const modelCandidates = [
    process.env.GEMINI_IMAGE_MODEL?.trim(),
    defaultImageModel,
    "imagen-3.0-fast-generate-001",
    "imagen-3.0-generate-001",
    "imagen-3.0-fast",
    "imagen-3.0",
  ].filter((m, idx, arr): m is string => Boolean(m) && arr.indexOf(m) === idx);

  try {
    // Enforce per-post limit if postId provided
    let remaining: number | undefined = undefined;
    let currentCount = 0;
    if (parsed.data.postId) {
      const post = await prisma.blogPost.findUnique({
        where: { id: parsed.data.postId },
        select: { id: true, imageGenCount: true },
      });
      if (!post) throw new Error("Post not found");
      currentCount = post.imageGenCount;
      if (currentCount >= 2) {
        return res.status(429).json({ message: "Image generation limit reached for this post" });
      }
      remaining = Math.max(0, 2 - (currentCount + 1));
    }

    let buffer: Buffer | null = null;
    let lastError: any = null;

    for (const apiVersion of apiVersions) {
      const ai = new GoogleGenAI({ apiKey, apiVersion });

      for (const modelName of modelCandidates) {
        try {
          const response: any = await ai.models.generateImages({
            model: modelName,
            prompt: imagePrompt,
            config: {
              numberOfImages: 1,
              aspectRatio: "16:9",
            },
          });

          const imgData =
            response?.generatedImages?.[0]?.image?.imageBytes ||
            response?.generatedImages?.[0]?.bytesBase64Encoded;

          if (imgData) {
            buffer = Buffer.from(imgData, "base64");
            break;
          }
        } catch (err: any) {
          lastError = err;
          continue;
        }
      }

      if (buffer) break;
    }

    if (!buffer) {
      throw lastError || new Error(`Failed to generate image. Tried API versions: ${apiVersions.join(", ")} and models: ${modelCandidates.join(", ")}`);
    }

    const key = buildUploadKey(`${Date.now()}-cover.png`);
    const upload = await uploadToS3({ fileBuffer: buffer, key, contentType: "image/png" });

    if (parsed.data.postId) {
      await prisma.blogPost.update({
        where: { id: parsed.data.postId },
        data: { imageGenCount: { increment: 1 } } as any,
      });
    }

    return res.json({
      url: upload.url,
      absoluteUrl: upload.absoluteUrl,
      storage: upload.storage,
      remaining,
    });
  } catch (err: any) {
    const responseDetail =
      err?.response?.data ||
      err?.response?.body ||
      err?.message ||
      err;
    console.error("Image Generation Error:", responseDetail);
    res.status(500).json({
      message: "Image generation failed.",
      detail: typeof responseDetail === "string" ? responseDetail : JSON.stringify(responseDetail),
    });
  }
}
