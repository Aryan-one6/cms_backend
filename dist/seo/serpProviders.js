"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSerpProvider = getSerpProvider;
const axios_1 = __importDefault(require("axios"));
class SerpApiProvider {
    constructor() {
        this.name = "serpapi";
    }
    async fetchOrganicResults(query) {
        const apiKey = process.env.SERPAPI_KEY;
        if (!apiKey) {
            throw new Error("SERPAPI_KEY is required for SerpAPI provider");
        }
        const res = await axios_1.default.get("https://serpapi.com/search.json", {
            params: {
                engine: "google",
                q: query.keyword,
                location: query.location,
                hl: query.language,
                num: query.num || 10,
                api_key: apiKey,
            },
        });
        const organic = res.data?.organic_results || [];
        return organic
            .filter((item) => item?.link)
            .slice(0, query.num || 10)
            .map((item, idx) => ({
            title: item.title || item.link || "",
            url: item.link || item.url,
            snippet: item.snippet,
            position: item.position || idx + 1,
            source: this.name,
        }));
    }
}
class DataForSeoProvider {
    constructor() {
        this.name = "dataforseo";
    }
    async fetchOrganicResults(query) {
        const login = process.env.DATAFORSEO_LOGIN;
        const password = process.env.DATAFORSEO_PASSWORD;
        if (!login || !password) {
            throw new Error("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required for DataForSEO provider");
        }
        const payload = [
            {
                keyword: query.keyword,
                location_name: query.location || "United States",
                language_name: query.language || "English",
                depth: query.num || 10,
                target: "google.com",
            },
        ];
        const res = await axios_1.default.post("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", payload, {
            auth: { username: login, password },
        });
        const items = res.data?.tasks?.[0]?.result?.[0]?.items || [];
        return items
            .filter((i) => i?.type === "organic" && i?.url)
            .slice(0, query.num || 10)
            .map((item, idx) => ({
            title: item.title || item.url,
            url: item.url,
            snippet: item.description,
            position: item.rank_absolute || item.rank_group || idx + 1,
            source: this.name,
        }));
    }
}
class ZenserpProvider {
    constructor() {
        this.name = "zenserp";
    }
    async fetchOrganicResults(query) {
        const apiKey = process.env.ZENSERP_API_KEY;
        if (!apiKey) {
            throw new Error("ZENSERP_API_KEY is required for Zenserp provider");
        }
        const res = await axios_1.default.get("https://app.zenserp.com/api/v2/search", {
            params: {
                q: query.keyword,
                location: query.location,
                hl: query.language,
                num: query.num || 10,
                apikey: apiKey,
                device: "desktop",
            },
        });
        const organic = res.data?.organic || [];
        return organic
            .filter((item) => item?.url)
            .slice(0, query.num || 10)
            .map((item, idx) => ({
            title: item.title || item.url,
            url: item.url,
            snippet: item.snippet,
            position: item.position || idx + 1,
            source: this.name,
        }));
    }
}
function getSerpProvider() {
    const selected = (process.env.SERP_PROVIDER || "serpapi").toLowerCase();
    if (selected === "dataforseo")
        return new DataForSeoProvider();
    if (selected === "zenserp")
        return new ZenserpProvider();
    return new SerpApiProvider();
}
