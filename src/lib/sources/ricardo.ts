import type { Listing } from "../types";
import { firecrawlScrape } from "./firecrawl";

interface RicardoItem {
  id: string;
  title: string;
  endDate?: string;
  creationDate?: string;
  conditionKey?: string;
  image?: string;
  hasBuyNow?: boolean;
  hasAuction?: boolean;
  bidPrice?: number | null;
  buyNowPrice?: number | null;
  bidsCount?: number;
  brand?: string | null;
  shipping?: Array<{ key?: string; cost?: number; zipCode?: string; city?: string }>;
}

/** Ricardo liefert Next.js-Flight-Daten in `self.__next_f.push([1,"..."])`-Chunks. */
function joinFlightChunks(html: string): string {
  const chunks: string[] = [];
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      chunks.push(JSON.parse(`"${m[1]}"`));
    } catch {
      /* defekter Chunk, überspringen */
    }
  }
  return chunks.join("");
}

function extractBalancedObject(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function extractItems(flight: string): RicardoItem[] {
  const items = new Map<string, RicardoItem>();
  const re = /\{"id":"(\d{6,})","title":"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flight))) {
    const raw = extractBalancedObject(flight, m.index);
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw) as RicardoItem;
      if (obj.endDate || obj.creationDate) items.set(obj.id, obj);
    } catch {
      /* kein sauberes Objekt */
    }
  }
  return [...items.values()];
}

function slugFromImage(image?: string): string | null {
  if (!image) return null;
  const m = image.match(/\/t_[^/]+\/([^/?#]+)$/);
  return m?.[1] ?? null;
}

function formatPrice(it: RicardoItem): string | null {
  const parts: string[] = [];
  if (it.buyNowPrice != null) parts.push(`CHF ${it.buyNowPrice} Sofortkauf`);
  if (it.hasAuction && it.bidPrice != null) parts.push(`CHF ${it.bidPrice} Gebot (${it.bidsCount ?? 0} Gebote)`);
  return parts.length ? parts.join(" · ") : null;
}

function toListing(it: RicardoItem): Listing {
  const slug = slugFromImage(it.image);
  const ship = it.shipping?.[0];
  const attributes: Record<string, string> = {};
  if (it.brand) attributes.Marke = it.brand;
  if (it.conditionKey) attributes.Zustand = it.conditionKey;
  if (it.endDate) attributes["Endet am"] = it.endDate;
  return {
    key: `ricardo:${it.id}`,
    id: it.id,
    source: "ricardo",
    title: it.title.trim(),
    body: null,
    price: formatPrice(it),
    location: ship ? [ship.zipCode, ship.city].filter(Boolean).join(" ") : null,
    url: slug ? `https://www.ricardo.ch/de/a/${slug}-${it.id}/` : `https://www.ricardo.ch/de/a/${it.id}/`,
    image: it.image ?? null,
    postedAt: it.creationDate ?? null,
    attributes,
  };
}

export async function searchRicardo(query: string, maxPages = 1): Promise<Listing[]> {
  const base = `https://www.ricardo.ch/de/s/${encodeURIComponent(query)}`;
  const pages = Array.from({ length: maxPages }, (_, i) => (i === 0 ? base : `${base}?page=${i + 1}`));
  const htmls = await Promise.all(pages.map((u) => firecrawlScrape(u, "rawHtml")));
  const seen = new Set<string>();
  const out: Listing[] = [];
  for (const html of htmls) {
    for (const it of extractItems(joinFlightChunks(html))) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(toListing(it));
    }
  }
  return out;
}

/**
 * Lädt die Ricardo-Artikelseite nach und extrahiert Attribute plus Beschreibung
 * als Text. Wird nur für aussichtsreiche Kandidaten aufgerufen.
 */
export async function fetchRicardoDetail(listing: Listing): Promise<Listing> {
  const md = await firecrawlScrape(listing.url, "markdown");
  const startIdx = md.indexOf("\n# ");
  const endIdx = md.indexOf("## Lieferung & Bezahlung");
  const section = md.slice(startIdx >= 0 ? startIdx : 0, endIdx > startIdx ? endIdx : undefined);
  const text = section
    .split("\n")
    .filter((l) => !l.startsWith("![") && !/^\s*\*\s*\*\s*\*\s*$/.test(l))
    .map((l) => l.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
  return { ...listing, body: text || listing.body };
}
