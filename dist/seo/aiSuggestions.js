"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSeoSuggestions = generateSeoSuggestions;
const genai_1 = require("@google/genai");
function fallbackSuggestions(input) {
    const headline = `Add an H2 focused on ${input.primaryKeyword}`;
    const faq = `What is ${input.primaryKeyword} and why does it matter?`;
    return {
        headings: [headline],
        faqs: [faq, ...input.questions.slice(0, 3)],
        paragraphSuggestions: [
            `Include a section that naturally weaves in ${input.missingTerms.slice(0, 5).join(", ")}`,
            "Break long paragraphs into shorter, scannable blocks with H3 subheads.",
        ],
        missingTerms: input.missingTerms,
    };
}
async function generateSeoSuggestions(input) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VERTEX_AI;
    if (!apiKey)
        return fallbackSuggestions(input);
    const ai = new genai_1.GoogleGenAI({ apiKey, apiVersion: "v1beta" });
    const prompt = `
You are an on-page SEO strategist. Based on the SERP benchmarks below, propose concrete improvements.

Primary keyword: ${input.primaryKeyword}
Secondary keywords: ${input.secondaryKeywords.join(", ") || "none"}
Benchmarks: ${JSON.stringify(input.benchmarks)}
Missing NLP terms: ${input.missingTerms.join(", ") || "none"}
PAA-style questions to cover: ${input.questions.slice(0, 6).join(" | ")}

Return JSON with:
{
  "headings": ["H2/H3 suggestions tailored to benchmarks"],
  "faqs": ["question 1", "question 2", ...],
  "paragraphSuggestions": ["short actionable rewrites or expansions"],
  "missingTerms": ["terms to weave in"]
}

Keep it concise. Do not include explanations.`;
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { temperature: 0.4, maxOutputTokens: 1024 },
        });
        const text = response?.candidates?.[0]?.content?.parts?.[0]?.text ??
            response?.text ??
            response?.response?.text?.() ??
            "";
        const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
        return {
            headings: parsed.headings || [],
            faqs: parsed.faqs || [],
            paragraphSuggestions: parsed.paragraphSuggestions || [],
            missingTerms: parsed.missingTerms || input.missingTerms,
        };
    }
    catch (err) {
        console.error("Failed to generate SEO suggestions", err);
        return fallbackSuggestions(input);
    }
}
