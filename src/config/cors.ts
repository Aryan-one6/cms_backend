import { prisma } from "./prisma";

// In-memory allowlist for verified domains. This avoids editing env on every verification.
const verifiedDomains = new Set<string>();

function normalizeDomain(domain: string) {
  const cleaned = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return cleaned.replace(/^www\./, "");
}

export function addVerifiedDomain(domain: string) {
  const norm = normalizeDomain(domain);
  if (!norm) return;
  // store base domain and common variants (www)
  verifiedDomains.add(norm);
  verifiedDomains.add(`www.${norm}`);
}

export async function hydrateVerifiedDomains() {
  const domains = await prisma.siteDomain.findMany({
    where: { status: "VERIFIED" },
    select: { domain: true },
  });
  domains.forEach((d) => addVerifiedDomain(d.domain));
}

// Check if an origin is allowed based on static list + verified domains (subdomains included).
export function isOriginAllowed(origin: string, staticOrigins: string[]) {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    // Always allow localhost / 127.0.0.1 on any port for dev/testing
    if (host === "localhost" || host === "127.0.0.1") return true;

    // direct match against static origins (origin string or hostname)
    if (staticOrigins.some((o) => o === origin || o === url.origin)) return true;

    // allow subdomains of verified domains
    for (const domain of verifiedDomains) {
      if (host === domain || host.endsWith(`.${domain}`)) return true;
    }
  } catch {
    return false;
  }
  return false;
}
