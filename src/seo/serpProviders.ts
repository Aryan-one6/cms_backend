import axios from "axios";
import { OrganicResult, SerpQuery } from "./types";

export interface SerpProvider {
  name: string;
  fetchOrganicResults(query: SerpQuery): Promise<OrganicResult[]>;
}

class SerpApiProvider implements SerpProvider {
  name = "serpapi";

  async fetchOrganicResults(query: SerpQuery): Promise<OrganicResult[]> {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      throw new Error("SERPAPI_KEY is required for SerpAPI provider");
    }

    const res = await axios.get("https://serpapi.com/search.json", {
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
    return (organic as any[])
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

class DataForSeoProvider implements SerpProvider {
  name = "dataforseo";

  async fetchOrganicResults(query: SerpQuery): Promise<OrganicResult[]> {
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

    const res = await axios.post(
      "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
      payload,
      {
        auth: { username: login, password },
      }
    );

    const items = res.data?.tasks?.[0]?.result?.[0]?.items || [];
    return (items as any[])
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

class ZenserpProvider implements SerpProvider {
  name = "zenserp";

  async fetchOrganicResults(query: SerpQuery): Promise<OrganicResult[]> {
    const apiKey = process.env.ZENSERP_API_KEY;
    if (!apiKey) {
      throw new Error("ZENSERP_API_KEY is required for Zenserp provider");
    }

    const res = await axios.get("https://app.zenserp.com/api/v2/search", {
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
    return (organic as any[])
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

export function getSerpProvider(): SerpProvider {
  const selected = (process.env.SERP_PROVIDER || "serpapi").toLowerCase();
  if (selected === "dataforseo") return new DataForSeoProvider();
  if (selected === "zenserp") return new ZenserpProvider();
  return new SerpApiProvider();
}
