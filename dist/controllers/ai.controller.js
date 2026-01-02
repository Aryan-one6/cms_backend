"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePostDraft = generatePostDraft;
exports.generateCoverImage = generateCoverImage;
const axios_1 = __importDefault(require("axios"));
const genai_1 = require("@google/genai");
const zod_1 = require("zod");
const slugify_1 = __importDefault(require("slugify"));
const storage_1 = require("../config/storage");
const prisma_1 = require("../config/prisma");
const defaultModel = "gemini-2.5-flash";
const defaultBase = "https://generativelanguage.googleapis.com/v1beta/models";
const defaultImageModel = "imagen-4.0-fast-generate-001"; // Vertex image model
const topicSchema = zod_1.z.object({
    topic: zod_1.z.string().min(3, "Topic is required"),
});
const imageSchema = zod_1.z.object({
    prompt: zod_1.z.string().min(4, "Prompt is required"),
    postId: zod_1.z.string().optional(),
});
const limits = {
    titleWords: 12,
    excerptWords: 40,
    contentWordsMin: 400,
    contentWordsMax: 800,
    tagWords: 3,
    tagCount: 6,
};
function trimWords(value, maxWords) {
    if (!value)
        return value;
    const words = value.split(/\s+/).filter(Boolean);
    return words.slice(0, maxWords).join(" ");
}
function wordCount(value) {
    if (!value)
        return 0;
    const text = value.replace(/<[^>]+>/g, " ");
    return text
        .split(/\s+/)
        .map((w) => w.trim())
        .filter(Boolean).length;
}
function normalizeTags(tags, topic, title) {
    if (!Array.isArray(tags))
        return undefined;
    const stopwords = new Set([
        "a",
        "an",
        "the",
        "to",
        "from",
        "for",
        "and",
        "or",
        "of",
        "in",
        "on",
        "at",
        "is",
        "are",
        "am",
        "this",
        "that",
        "with",
        "by",
        "it",
        "its",
        "be",
        "as",
        "into",
        "over",
        "under",
        "per",
    ]);
    const titleWords = (title || "")
        .toLowerCase()
        .split(/\s+/)
        .map((w) => w.replace(/[^a-z0-9-]/g, ""))
        .filter(Boolean);
    const topicWords = (topic || "")
        .toLowerCase()
        .split(/\s+/)
        .map((w) => w.replace(/[^a-z0-9-]/g, ""))
        .filter(Boolean);
    const phrases = tags
        .map((t) => (typeof t === "string" ? t : String(t ?? "")))
        .flatMap((t) => t.split(/[,|;]/))
        .map((t) => t.trim())
        .filter(Boolean);
    const cleaned = phrases
        .map((phrase) => {
        const words = phrase
            .toLowerCase()
            .split(/\s+/)
            .map((w) => w.replace(/[^a-z0-9-]/g, ""))
            .filter((w) => w && !stopwords.has(w) && !/^\d+$/.test(w));
        if (!words.length)
            return "";
        const limited = words.slice(0, limits.tagWords).join(" ").trim();
        return limited.length >= 3 && limited.length <= 40 ? limited : "";
    })
        .filter(Boolean)
        .filter((p) => !titleWords.includes(p) && !topicWords.includes(p));
    const unique = Array.from(new Set(cleaned)).slice(0, limits.tagCount);
    return unique.length ? unique : undefined;
}
function safeSlug(value) {
    const base = (value || "draft").toString();
    return (0, slugify_1.default)(base, { lower: true, strict: true });
}
function tagsFromTopic(topic, title) {
    const base = `${title || ""} ${topic}`.toLowerCase();
    const stopwords = new Set([
        "a",
        "an",
        "the",
        "to",
        "from",
        "for",
        "and",
        "or",
        "of",
        "in",
        "on",
        "at",
        "is",
        "are",
        "am",
        "this",
        "that",
        "with",
        "by",
        "it",
        "its",
        "be",
        "as",
        "into",
        "over",
        "under",
        "per",
    ]);
    const words = base
        .split(/\s+/)
        .map((w) => w.replace(/[^a-z0-9-]/g, ""))
        .filter((w) => w && !stopwords.has(w) && !/^\d+$/.test(w));
    const unique = Array.from(new Set(words)).slice(0, limits.tagCount);
    return unique;
}
function renderTagList(tags) {
    if (!tags?.length)
        return "";
    return `<ul>${tags
        .slice(0, limits.tagCount)
        .map((t) => `<li>${t}</li>`)
        .join("")}</ul>`;
}
function fallbackContent({ title, excerpt, topic, }) {
    const headline = title || (topic ? `Guide to ${topic}` : "Article draft");
    const intro = excerpt ||
        (topic
            ? `A concise outline covering ${topic}.`
            : "Here is a clean outline to start your article.");
    return [`<h2>${headline}</h2>`, `<p>${intro}</p>`].join("");
}
function organizeContentHtml({ rawContent, title, excerpt, topic, }) {
    const cleaned = rawContent?.trim();
    const structuredFallback = () => fallbackContent({ title, excerpt, topic });
    if (!cleaned)
        return structuredFallback();
    const hasHtmlTags = /<\/?[a-z][\s\S]*>/i.test(cleaned);
    if (hasHtmlTags)
        return cleaned;
    const paragraphs = cleaned
        .split(/\n{2,}/)
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter(Boolean);
    if (paragraphs.length) {
        const parts = [];
        if (title || topic)
            parts.push(`<h2>${title || `Guide to ${topic}`}</h2>`);
        if (excerpt)
            parts.push(`<p>${excerpt}</p>`);
        parts.push("<h3>Details</h3>");
        parts.push(paragraphs.map((p) => `<p>${p}</p>`).join(""));
        return parts.join("");
    }
    return structuredFallback();
}
function generateSupplementContent({ title, topic, excerpt, currentWords, }) {
    const heading = title || `Guide to ${topic}`;
    const intro = excerpt ||
        `A practical walkthrough of ${topic} with clear, human explanations.`;
    const baseTopic = topic || heading;
    const themeList = [
        {
            title: "What matters most",
            body: `Core criteria for ${baseTopic}: what to prioritize and why it affects the outcome.`,
        },
        {
            title: "How to compare options",
            body: "Lay out the key dimensions that separate good from bad choices. Keep it specific to this topic.",
        },
        {
            title: "Common mistakes",
            body: "List pitfalls and how to avoid them with concise, actionable guidance.",
        },
        {
            title: "Step-by-step approach",
            body: "Give a short process readers can follow. Include an example so it feels practical.",
        },
        {
            title: "Tools and resources",
            body: "Name helpful tools, data points, or checkpoints to validate decisions.",
        },
        {
            title: "When to get expert help",
            body: "Explain signals that it's worth consulting a pro or using a premium option.",
        },
        {
            title: "Wrap-up and next step",
            body: "A concise verdict plus the single action the reader should take now.",
        },
    ];
    const sections = themeList.map((item, idx) => {
        const anchor = idx + 1;
        return [
            `<h3>${anchor}. ${item.title}</h3>`,
            `<p>${item.body}</p>`,
            `<p>Use concrete details and an example that mentions ${baseTopic} without repeating the headline. Close with one takeaway that moves the reader toward a decision.</p>`,
        ].join("");
    });
    const close = [
        "<h3>Wrap up</h3>",
        `<p>End with a short verdict that echoes ${heading}. Tell readers what to do next (compare options, check policies, or save money) and reassure them why these steps follow naturally from the sections above.</p>`,
    ].join("");
    const assembled = [
        `<h2>${heading}</h2>`,
        `<p>${intro}</p>`,
        sections.join(""),
        close,
    ].join("");
    // If still short, add an FAQ paragraph that references topic and title.
    const wordsAfter = currentWords + wordCount(assembled);
    if (wordsAfter < limits.contentWordsMin) {
        const faq = [
            "<h3>FAQ</h3>",
            `<p>What should readers remember about ${heading}? Focus on the key differentiators, how they affect the traveler, and when each option makes sense. Avoid repeating earlier sentences—offer a crisp takeaway instead.</p>`,
        ].join("");
        return assembled + faq;
    }
    return assembled;
}
function ensureMinimumContent({ contentHtml, title, excerpt, topic, }) {
    let html = contentHtml || "";
    const words = wordCount(html);
    if (words >= limits.contentWordsMin)
        return trimWords(html, limits.contentWordsMax);
    const supplement = generateSupplementContent({
        title,
        topic,
        excerpt,
        currentWords: words,
    });
    // Drop overly generic headings from the supplement when the base content already starts with one.
    const cleanedSupplement = supplement.replace(/<h2>.*?<\/h2>/i, "");
    const combined = [html, cleanedSupplement].filter(Boolean).join("\n");
    return trimWords(combined, limits.contentWordsMax);
}
function scrubAiPhrases(html) {
    return (html
        // Remove AI-sounding scaffolding headings
        .replace(/<h3[^>]*>[^<]*finish this draft[^<]*<\/h3>/gi, "")
        .replace(/<h3[^>]*>[^<]*quick takeaways[^<]*<\/h3>/gi, "")
        .replace(/<p[^>]*>\s*quick takeaways\s*<\/p>/gi, "")
        // Remove empty lists/paragraphs created after removals
        .replace(/<ul>\s*<\/ul>/gi, "")
        .replace(/<p>\s*<\/p>/gi, ""));
}
function tryParseJson(text) {
    const cleaned = text
        .trim()
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/, "")
        .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    const candidate = match ? match[0] : cleaned;
    return JSON.parse(candidate);
}
function parseStructuredLines(text) {
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    const pick = (label) => {
        const line = lines.find((l) => l.toUpperCase().startsWith(label));
        if (!line)
            return undefined;
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
async function generatePostDraft(req, res) {
    const parsed = topicSchema.safeParse(req.body);
    if (!parsed.success) {
        return res
            .status(400)
            .json({
            message: parsed.error.issues[0]?.message || "Topic is required",
        });
    }
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey)
        return res.status(500).json({ message: "Missing Gemini API key" });
    const model = process.env.GEMINI_MODEL?.trim() || defaultModel;
    const baseUrl = process.env.GEMINI_BASE_URL?.trim() || defaultBase;
    const prompt = `You are an SEO copywriter generating a full blog draft for "${parsed.data.topic}".
Return the draft in EXACTLY this 5-line format (no extra text):
TITLE: <title up to ${limits.titleWords} words>
SLUG: <url-safe slug>
EXCERPT: <excerpt up to ${limits.excerptWords} words matching the title context>
TAGS: <up to ${limits.tagCount} tags separated by |, each up to ${limits.tagWords} words; relevant to the topic; no throwaway words>
CONTENT_HTML_BASE64: <base64 encoded HTML between ${limits.contentWordsMin} and ${limits.contentWordsMax} words when decoded; avoid repeating the headline; write a full article with intro, 5-7 subheadings, detailed paragraphs, and 1 short list; keep sections contextual to the title/excerpt/slug/tags; no filler instructions; concise, readable style>`;
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
        const { data } = await axios_1.default.post(url, body, {
            headers: { "Content-Type": "application/json" },
        });
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        let parsedJson;
        let structured;
        try {
            parsedJson = tryParseJson(text);
        }
        catch {
            structured = parseStructuredLines(text);
        }
        const title = trimWords(parsedJson?.title ?? structured?.title, limits.titleWords);
        const excerpt = trimWords(parsedJson?.excerpt ?? structured?.excerpt, limits.excerptWords);
        const tags = normalizeTags(parsedJson?.tags ?? structured?.tags, parsed.data.topic, title) ||
            normalizeTags(tagsFromTopic(parsed.data.topic, title), parsed.data.topic, title) ||
            tagsFromTopic(parsed.data.topic, title);
        const contentBase64 = parsedJson?.contentHtmlBase64 ??
            parsedJson?.contentHtml ??
            structured?.contentBase64;
        let contentHtml;
        if (typeof contentBase64 === "string") {
            try {
                contentHtml = Buffer.from(contentBase64, "base64").toString("utf8");
            }
            catch {
                contentHtml = contentBase64;
            }
        }
        contentHtml = trimWords(contentHtml, limits.contentWordsMax);
        const slugRaw = parsedJson?.slug ?? structured?.slug ?? title;
        const slug = slugRaw ? safeSlug(slugRaw) : safeSlug("draft");
        if (!contentHtml && (title || excerpt || tags?.length)) {
            contentHtml = fallbackContent({
                title,
                excerpt,
                topic: parsed.data.topic,
            });
        }
        contentHtml = organizeContentHtml({
            rawContent: contentHtml,
            title,
            excerpt,
            topic: parsed.data.topic,
        });
        contentHtml = ensureMinimumContent({
            contentHtml,
            title,
            excerpt,
            topic: parsed.data.topic,
        });
        contentHtml = scrubAiPhrases(contentHtml || "");
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
    }
    catch (err) {
        const message = err?.response?.data?.message ||
            err?.response?.data?.error?.message ||
            err?.message ||
            "Unable to generate draft";
        return res.status(500).json({ message });
    }
}
async function generateCoverImage(req, res) {
    const parsed = imageSchema.safeParse(req.body);
    if (!parsed.success) {
        return res
            .status(400)
            .json({
            message: parsed.error.issues[0]?.message || "Prompt is required",
        });
    }
    const prompt = parsed.data.prompt;
    const postId = parsed.data.postId;
    const vertexKey = process.env.VERTEX_AI;
    const imageModel = process.env.GEMINI_IMAGE_MODEL?.trim() || defaultImageModel;
    const modelCandidates = [
        imageModel,
        "imagen-3.0-fast-generate-001",
        "imagen-3.0-generate-001",
    ].filter(Boolean);
    try {
        if (!vertexKey)
            throw new Error("Missing image API key");
        const ai = new genai_1.GoogleGenAI({
            apiKey: vertexKey,
        });
        let lastError = null;
        let buffer = null;
        for (const model of modelCandidates) {
            try {
                const response = await ai.models.generateImages({
                    model,
                    prompt,
                    config: { numberOfImages: 1, aspectRatio: "16:9" },
                });
                const r = response;
                const imgData = r.generatedImages?.[0]?.image?.imageBytes ||
                    r.generatedImages?.[0]?.imageBytes ||
                    r.generatedImages?.[0]?.image?.data ||
                    r.generatedImages?.[0]?.bytesBase64Encoded;
                if (!imgData) {
                    throw new Error(r.filteredReason || `No image returned from Vertex for model ${model}`);
                }
                buffer = Buffer.from(imgData, "base64");
                break;
            }
            catch (err) {
                lastError = err;
                continue;
            }
        }
        if (!buffer) {
            throw lastError || new Error("No image model succeeded");
        }
        // enforce per-post limit if postId provided
        let remaining = undefined;
        let currentCount = 0;
        if (postId) {
            const post = (await prisma_1.prisma.blogPost.findUnique({
                where: { id: postId },
                select: { id: true, imageGenCount: true },
            }));
            if (!post)
                throw new Error("Post not found");
            currentCount = post.imageGenCount;
            if (currentCount >= 2) {
                return res.status(429).json({ message: "Image generation limit reached for this post" });
            }
            remaining = Math.max(0, 2 - (currentCount + 1));
        }
        const key = (0, storage_1.buildUploadKey)(`${Date.now()}-cover.png`);
        const upload = await (0, storage_1.uploadToS3)({ fileBuffer: buffer, key, contentType: "image/png" });
        if (postId) {
            await prisma_1.prisma.blogPost.update({
                where: { id: postId },
                // Cast to any to satisfy type checker if generated types lag schema
                data: { imageGenCount: { increment: 1 } },
            });
        }
        res.json({
            url: upload.url,
            absoluteUrl: upload.absoluteUrl,
            storage: upload.storage,
            remaining,
        });
    }
    catch (err) {
        let responseDetail = err?.response?.data;
        if (Buffer.isBuffer(responseDetail)) {
            try {
                responseDetail = responseDetail.toString("utf8");
            }
            catch {
                // leave as buffer
            }
        }
        console.error("Cover image generation failed", responseDetail || err);
        const detail = responseDetail?.error ||
            responseDetail?.message ||
            responseDetail ||
            err?.message ||
            "Unable to generate image right now";
        res.status(500).json({ message: "Image generation failed", detail });
    }
}
