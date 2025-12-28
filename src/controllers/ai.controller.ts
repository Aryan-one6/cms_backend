import { Request, Response } from "express";
import axios from "axios";
import { z } from "zod";
import slugify from "slugify";

const defaultModel = "gemini-2.5-flash";
const defaultBase = "https://generativelanguage.googleapis.com/v1beta/models";

const topicSchema = z.object({
  topic: z.string().min(3, "Topic is required"),
});

const limits = {
  titleWords: 12,
  excerptWords: 40,
  contentWords: 800,
  tagWords: 3,
  tagCount: 6,
};

function trimWords(value: string | undefined, maxWords: number) {
  if (!value) return value;
  const words = value.split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

function normalizeTags(tags: unknown) {
  if (!Array.isArray(tags)) return undefined;
  const cleaned = tags
    .map((t) => (typeof t === "string" ? t : String(t ?? "")))
    .map((t) => trimWords(t, limits.tagWords))
    .filter(Boolean) as string[];
  if (!cleaned.length) return undefined;
  return cleaned.slice(0, limits.tagCount);
}

function safeSlug(value: string | undefined) {
  const base = (value || "draft").toString();
  return slugify(base, { lower: true, strict: true });
}

function tagsFromTopic(topic: string) {
  const words = topic
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.replace(/[^a-z0-9-]+/gi, ""))
    .filter(Boolean);
  const unique = Array.from(new Set(words));
  return unique.slice(0, limits.tagCount);
}

function fallbackContent(title?: string, excerpt?: string, tags?: string[]) {
  const parts = [];
  if (title) parts.push(`<h2>${title}</h2>`);
  if (excerpt) parts.push(`<p>${excerpt}</p>`);
  if (tags?.length) {
    parts.push(
      `<ul>${tags
        .slice(0, limits.tagCount)
        .map((t) => `<li>${t}</li>`)
        .join("")}</ul>`
    );
  }
  return parts.join("\n");
}

function tryParseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : cleaned;
  return JSON.parse(candidate);
}

function parseStructuredLines(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const pick = (label: string) => {
    const line = lines.find((l) => l.toUpperCase().startsWith(label));
    if (!line) return undefined;
    return line.slice(label.length).replace(/^:/, "").trim();
  };

  const title = pick("TITLE");
  const slug = pick("SLUG");
  const excerpt = pick("EXCERPT");
  const tagsLine = pick("TAGS");
  const contentBase64 = pick("CONTENT_HTML_BASE64");

  const tags = tagsLine
    ?.split(/[,|;]/)
    .map((t) => t.trim())
    .filter(Boolean);

  return { title, slug, excerpt, tags, contentBase64 };
}

export async function generatePostDraft(req: Request, res: Response) {
  const parsed = topicSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message || "Topic is required" });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ message: "Missing Gemini API key" });

  const model = process.env.GEMINI_MODEL?.trim() || defaultModel;
  const baseUrl = process.env.GEMINI_BASE_URL?.trim() || defaultBase;

const prompt = `You are an SEO copywriter generating a full blog draft for "${parsed.data.topic}".
Return the draft in EXACTLY this 5-line format (no extra text):
TITLE: <title up to ${limits.titleWords} words>
SLUG: <url-safe slug>
EXCERPT: <excerpt up to ${limits.excerptWords} words>
TAGS: <up to ${limits.tagCount} tags separated by |, each up to ${limits.tagWords} words>
CONTENT_HTML_BASE64: <base64 encoded HTML up to ${limits.contentWords} words when decoded; include headings, paragraphs, lists, and links where natural>`;

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.65,
      maxOutputTokens: 1200,
    },
  };

  try {
    const url = `${baseUrl}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const { data } = await axios.post(url, body, {
      headers: { "Content-Type": "application/json" },
    });

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let parsedJson: any;
    let structured: any;

    try {
      parsedJson = tryParseJson(text);
    } catch {
      structured = parseStructuredLines(text);
    }

    const title = trimWords(parsedJson?.title ?? structured?.title, limits.titleWords);
    const excerpt = trimWords(parsedJson?.excerpt ?? structured?.excerpt, limits.excerptWords);
    const tags =
      normalizeTags(parsedJson?.tags ?? structured?.tags) ||
      normalizeTags(tagsFromTopic(parsed.data.topic));
    const contentBase64 =
      parsedJson?.contentHtmlBase64 ??
      parsedJson?.contentHtml ??
      structured?.contentBase64;
    let contentHtml: string | undefined;
    if (typeof contentBase64 === "string") {
      try {
        contentHtml = Buffer.from(contentBase64, "base64").toString("utf8");
      } catch {
        contentHtml = contentBase64;
      }
    }
    contentHtml = trimWords(contentHtml, limits.contentWords);
    const slugRaw = parsedJson?.slug ?? structured?.slug ?? title;
    const slug = slugRaw ? safeSlug(slugRaw) : safeSlug("draft");

    if (!contentHtml && (title || excerpt || tags?.length)) {
      contentHtml = fallbackContent(title, excerpt, tags ?? undefined);
    }

    if (!title && !excerpt && !contentHtml) {
      throw new Error("AI response was not valid JSON. Please try again.");
    }

    return res.json({
      draft: {
        title,
        slug,
        excerpt,
        contentHtml,
        tags,
      },
    });
  } catch (err: any) {
    const message =
      err?.response?.data?.message ||
      err?.response?.data?.error?.message ||
      err?.message ||
      "Unable to generate draft";
    return res.status(500).json({ message });
  }
}
