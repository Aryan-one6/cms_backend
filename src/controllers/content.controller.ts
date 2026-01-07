import { Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import slugify from "slugify";

const defaultModel = "gemini-2.0-flash";

const topicSchema = z.object({
  topic: z.string().min(3, "Topic is required"),
});

const limits = {
  titleWords: 15,
  excerptWords: 55,
  tagCount: 8,
};

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function trimWords(value: string | undefined, maxWords: number) {
  if (!value) return value;
  const words = value.split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

function wordCount(value: string | undefined) {
  if (!value) return 0;
  const text = value.replace(/<[^>]+>/g, " ");
  return text.split(/\s+/).filter(Boolean).length;
}

function safeSlug(value: string | undefined) {
  return slugify(value || "draft", { lower: true, strict: true });
}

function tryParseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned);
}

async function with429Retry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.response?.status || err?.status || err?.code;
      const isRateLimited = status === 429 || status === "429" || status === "RESOURCE_EXHAUSTED";
      if (!isRateLimited || attempt === retries) throw err;
      lastError = err;
      await sleep(2000 * Math.pow(2, attempt));
    }
  }
  throw lastError;
}

export async function generatePostDraft(req: Request, res: Response) {
  const parsed = topicSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Topic is required" });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.VERTEX_AI;
  if (!apiKey) return res.status(500).json({ message: "Missing Gemini API key" });

  const ai = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });

  const prompt = `
Act as an Elite SEO Content Strategist. Your mission is to write a definitive, 1200-word authority guide on "${parsed.data.topic}".

### CONTENT GUIDELINES:
1. **Length:** Minimum 1000-1200 words. Be extremely detailed.
2. **SEO Architecture:** Use one H1, 6-8 H2 headings, and H3 sub-headings for deep technical dives.
3. **Elements:** Include a "Key Takeaways" bulleted summary at the start and a 5-question FAQ at the end.
4. **HTML:** Use <strong> for emphasis, <ul>/<li> for lists. Do NOT include generic "Introduction" or "Conclusion" headers.

### OUTPUT FORMAT:
Return ONLY a valid JSON object:
{
  "title": "Captivating SEO Title",
  "slug": "optimized-url-slug",
  "excerpt": "Compelling meta description (max 50 words)",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8"],
  "contentHtml": "Provide the full article HTML here. Ensure the body text alone is at least 1000 words. Include all H2, H3, lists, and FAQ as requested."
}`;

  try {
    const response: any = await with429Retry(() =>
      ai.models.generateContent({
        model: defaultModel,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature: 0.7,
          maxOutputTokens: 8192,
        },
      })
    );

    const text =
      response?.candidates?.[0]?.content?.parts?.[0]?.text ??
      response?.text ??
      response?.response?.text?.() ??
      "";

    const aiOutput = tryParseJson(text || "{}");

    const contentHtml: string = aiOutput.contentHtml || "";
    if (!contentHtml.trim()) {
      throw new Error("AI did not return contentHtml");
    }

    const draft = {
      title: trimWords(aiOutput.title, limits.titleWords),
      slug: safeSlug(aiOutput.slug || aiOutput.title),
      excerpt: trimWords(aiOutput.excerpt, limits.excerptWords),
      contentHtml,
      tags: (aiOutput.tags || []).slice(0, limits.tagCount),
      wordCount: wordCount(contentHtml),
    };

    return res.json({ draft });
  } catch (err: any) {
    console.error("Draft Generation Error:", err?.message || err);
    const isRateLimited = err?.message?.includes?.("429") || err?.status === 429;
    return res.status(isRateLimited ? 429 : 500).json({
      message: isRateLimited ? "Rate limit reached. Please wait a moment." : "Failed to generate content.",
      detail: err?.message || "Unknown error",
    });
  }
}
