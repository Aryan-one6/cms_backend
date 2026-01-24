"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripHtml = stripHtml;
exports.normalizeWhitespace = normalizeWhitespace;
exports.normalizeText = normalizeText;
exports.tokenize = tokenize;
exports.termFrequency = termFrequency;
exports.topTerms = topTerms;
exports.topPhrases = topPhrases;
exports.extractQuestionPhrases = extractQuestionPhrases;
exports.escapeRegExp = escapeRegExp;
exports.countOccurrences = countOccurrences;
exports.averageSentenceLength = averageSentenceLength;
const STOPWORDS = new Set([
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves"
]);
function stripHtml(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--.*?-->/gs, " ")
        .replace(/<\/?[^>]+(>|$)/g, " ");
}
function normalizeWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
}
function normalizeText(text) {
    return normalizeWhitespace(text.toLowerCase().replace(/[^a-z0-9\s\?]/gi, " "));
}
function tokenize(text) {
    return normalizeText(text)
        .split(/\s+/)
        .filter((t) => t && !STOPWORDS.has(t));
}
function termFrequency(tokens) {
    const freq = {};
    for (const t of tokens) {
        freq[t] = (freq[t] || 0) + 1;
    }
    return freq;
}
function topTerms(tokens, limit = 30) {
    const freq = termFrequency(tokens);
    return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([term, score]) => ({ term, score }));
}
function buildPhrases(tokens, n) {
    const phrases = {};
    for (let i = 0; i < tokens.length - (n - 1); i++) {
        const phrase = tokens.slice(i, i + n).join(" ");
        if (!phrase.trim())
            continue;
        phrases[phrase] = (phrases[phrase] || 0) + 1;
    }
    return phrases;
}
function topPhrases(tokens, n, limit = 30) {
    const phrases = buildPhrases(tokens, n);
    return Object.entries(phrases)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([term, score]) => ({ term, score }));
}
function extractQuestionPhrases(text) {
    const sentences = text.split(/[\.\!\?]/).map((s) => s.trim());
    const questions = sentences.filter((s) => /^(who|what|when|where|why|how|which|can|do|does|should)\b/i.test(s));
    const explicit = (text.match(/[^?]{3,}\?/g) || []).map((s) => s.replace("?", "").trim());
    return Array.from(new Set([...questions, ...explicit])).filter(Boolean);
}
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function countOccurrences(text, term) {
    if (!term.trim())
        return 0;
    const regex = new RegExp(`\\b${escapeRegExp(term.trim())}\\b`, "gi");
    return (text.match(regex) || []).length;
}
function averageSentenceLength(text) {
    const sentences = text.split(/[\.\!\?]/).map((s) => s.trim()).filter(Boolean);
    if (!sentences.length)
        return 0;
    const words = sentences.map((s) => tokenize(s).length).filter((n) => n > 0);
    if (!words.length)
        return 0;
    return words.reduce((a, b) => a + b, 0) / words.length;
}
