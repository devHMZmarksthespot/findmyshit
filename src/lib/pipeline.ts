import { assessListings, extractCriteria } from "./claude";
import { fetchRicardoDetail, searchRicardo } from "./sources/ricardo";
import { searchTutti } from "./sources/tutti";
import type { Assessment, Listing, RankedListing, SearchEvent, Source } from "./types";

const BATCH_SIZE = 25;
const MAX_QUERIES = 5;
const DETAIL_CANDIDATES = 8;
const DETAIL_MIN_SCORE = 30;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function settled<T>(label: string, p: Promise<T>): Promise<{ label: string; value?: T; error?: string }> {
  try {
    return { label, value: await p };
  } catch (e) {
    return { label, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function* runSearch(description: string): AsyncGenerator<SearchEvent> {
  yield { type: "status", message: "Beschreibung wird in Kriterien zerlegt …" };
  const criteria = await extractCriteria(description);
  yield { type: "criteria", criteria };

  const queries = criteria.searchQueries.slice(0, MAX_QUERIES);
  yield { type: "status", message: `Suche auf Tutti und Ricardo mit ${queries.length} Suchbegriffen …` };

  const jobs = queries.flatMap((q) => [
    settled(`Tutti „${q}“`, searchTutti(q, 2)),
    settled(`Ricardo „${q}“`, searchRicardo(q, 1)),
  ]);
  const outcomes = await Promise.all(jobs);

  const pool = new Map<string, Listing>();
  for (const o of outcomes) {
    if (o.error) {
      yield { type: "warning", message: `${o.label}: ${o.error}` };
      continue;
    }
    for (const l of o.value ?? []) if (!pool.has(l.key)) pool.set(l.key, l);
  }
  const listings = [...pool.values()];
  const bySource: Record<Source, number> = { tutti: 0, ricardo: 0 };
  for (const l of listings) bySource[l.source]++;
  yield { type: "collected", total: listings.length, bySource, queries };

  if (listings.length === 0) {
    yield { type: "results", results: [] };
    return;
  }

  yield { type: "status", message: `${listings.length} Inserate werden gegen die Kriterien geprüft …` };
  const batches = chunk(listings, BATCH_SIZE);
  const assessed = (await Promise.all(batches.map((b) => assessListings(criteria, b)))).flat();
  const byKey = new Map<string, Assessment>(assessed.map((a) => [a.key, a]));

  // Ricardo zeigt auf der Suchseite keine Beschreibung: aussichtsreiche Kandidaten nachladen und neu bewerten.
  const detailTargets = listings
    .filter((l) => l.source === "ricardo" && !l.body)
    .filter((l) => (byKey.get(l.key)?.score ?? 0) >= DETAIL_MIN_SCORE)
    .sort((a, b) => (byKey.get(b.key)?.score ?? 0) - (byKey.get(a.key)?.score ?? 0))
    .slice(0, DETAIL_CANDIDATES);

  const detailed = new Set<string>();
  if (detailTargets.length > 0) {
    yield { type: "status", message: `${detailTargets.length} Ricardo-Kandidaten: Detailseiten werden nachgeladen …` };
    const fetched = await Promise.all(detailTargets.map((l) => settled(l.title, fetchRicardoDetail(l))));
    const enriched: Listing[] = [];
    for (const f of fetched) {
      if (f.error) {
        yield { type: "warning", message: `Detail „${f.label}“: ${f.error}` };
        continue;
      }
      if (f.value) {
        enriched.push(f.value);
        pool.set(f.value.key, f.value);
        detailed.add(f.value.key);
      }
    }
    if (enriched.length > 0) {
      for (const a of await assessListings(criteria, enriched)) byKey.set(a.key, a);
    }
  }

  const results: RankedListing[] = [...pool.values()]
    .map((l) => ({
      ...l,
      detailChecked: detailed.has(l.key),
      assessment: byKey.get(l.key) ?? {
        key: l.key,
        score: 0,
        verdict: "no" as const,
        reasons: ["Nicht bewertet."],
        evidence: "",
        missingInfo: [],
      },
    }))
    .sort((a, b) => b.assessment.score - a.assessment.score);

  yield { type: "results", results };
}
