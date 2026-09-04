import type { Listing } from "../types";
import { firecrawlScrape } from "./firecrawl";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const PAGE_SIZE = 30;

/**
 * Direkter Abruf funktioniert von Wohn-IPs. Rechenzentrums-IPs (z.B. Vercel)
 * bekommen von Tutti ein 403, dann wird über Firecrawl geladen.
 */
async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, "accept-language": "de-CH,de;q=0.9" },
    cache: "no-store",
  });
  if (res.ok) return res.text();
  if (res.status === 403 || res.status === 429) return firecrawlScrape(url, "rawHtml");
  throw new Error(`Tutti antwortet mit HTTP ${res.status} für ${url}`);
}

interface TuttiNode {
  listingID: string;
  timestamp?: string;
  formattedPrice?: string;
  localization?: { title?: string; body?: string };
  postcodeInformation?: { postcode?: string; locationName?: string };
  thumbnail?: { normalRendition?: { src?: string } };
  seoInformation?: { deSlug?: string };
  primaryCategory?: { categoryID?: string };
}

function extractNodes(html: string): { nodes: TuttiNode[]; totalCount: number } {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Tutti: kein __NEXT_DATA__ im HTML gefunden");
  const data = JSON.parse(m[1]);
  const queries: Array<{ state?: { data?: { listings?: { edges?: Array<{ node: TuttiNode }>; totalCount?: number } } } }> =
    data?.props?.pageProps?.dehydratedState?.queries ?? [];
  for (const q of queries) {
    const listings = q.state?.data?.listings;
    if (listings?.edges) {
      return {
        nodes: listings.edges.map((e) => e.node),
        totalCount: listings.totalCount ?? listings.edges.length,
      };
    }
  }
  return { nodes: [], totalCount: 0 };
}

function toListing(n: TuttiNode): Listing {
  const slug = n.seoInformation?.deSlug ?? "";
  const pc = n.postcodeInformation;
  return {
    key: `tutti:${n.listingID}`,
    id: n.listingID,
    source: "tutti",
    title: (n.localization?.title ?? "").trim(),
    body: n.localization?.body?.trim() || null,
    price: n.formattedPrice ? `CHF ${n.formattedPrice}` : null,
    location: pc ? [pc.postcode, pc.locationName].filter(Boolean).join(" ") : null,
    url: `https://www.tutti.ch/de/vi/${slug}/${n.listingID}`,
    image: n.thumbnail?.normalRendition?.src ?? null,
    postedAt: n.timestamp ?? null,
    attributes: n.primaryCategory?.categoryID ? { Kategorie: n.primaryCategory.categoryID } : {},
  };
}

/**
 * Sucht auf Tutti.ch. Seite 1 über den Query-Parameter, weitere Seiten über die
 * Hash-URL, die Tutti in Seite 1 einbettet (nur so funktioniert `page=N`).
 */
export async function searchTutti(query: string, maxPages = 2): Promise<Listing[]> {
  const first = await fetchHtml(`https://www.tutti.ch/de/q/suche?query=${encodeURIComponent(query)}`);
  const { nodes, totalCount } = extractNodes(first);
  const all = [...nodes];

  // Tutti bettet die kanonische Such-URL mit Query-Hash ein, z.B. /de/q/suche/<hash> oder /de/q/beizentische/<hash>.
  // Nur über diese URL funktioniert `?page=N`.
  const canonical =
    first.match(/<link rel="canonical" href="(https:\/\/www\.tutti\.ch\/de\/q\/[^"?]+)"/)?.[1] ??
    first.match(/https:\/\/www\.tutti\.ch\/de\/q\/[a-z0-9-]+\/[A-Za-z0-9_-]{8,}/)?.[0];
  const pages = Math.min(maxPages, Math.ceil(totalCount / PAGE_SIZE));
  if (canonical && pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) =>
        fetchHtml(`${canonical}?page=${i + 2}`).then((h) => extractNodes(h).nodes),
      ),
    );
    for (const r of rest) all.push(...r);
  }
  return all.map(toListing);
}
