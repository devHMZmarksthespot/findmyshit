export type Source = "tutti" | "ricardo";

export interface Listing {
  /** Eindeutig über alle Quellen: `${source}:${id}` */
  key: string;
  id: string;
  source: Source;
  title: string;
  /** Beschreibungstext, falls auf der Suchseite vorhanden (Tutti ja, Ricardo erst nach Detail-Abruf) */
  body: string | null;
  price: string | null;
  location: string | null;
  url: string;
  image: string | null;
  postedAt: string | null;
  attributes: Record<string, string>;
}

export interface Criteria {
  objectType: string;
  brand: string | null;
  materials: string[];
  dimensionsCm: {
    length: number | null;
    width: number | null;
    height: number | null;
    toleranceCm: number;
  };
  mustHave: string[];
  niceToHave: string[];
  searchQueries: string[];
}

export type Verdict = "match" | "possible" | "no";

export interface Assessment {
  key: string;
  score: number;
  verdict: Verdict;
  reasons: string[];
  evidence: string;
  missingInfo: string[];
}

export interface RankedListing extends Listing {
  assessment: Assessment;
  /** true wenn für dieses Inserat die Detailseite nachgeladen wurde */
  detailChecked: boolean;
}

export type SearchEvent =
  | { type: "status"; message: string }
  | { type: "warning"; message: string }
  | { type: "criteria"; criteria: Criteria }
  | { type: "collected"; total: number; bySource: Record<Source, number>; queries: string[] }
  | { type: "results"; results: RankedListing[] }
  | { type: "error"; message: string };
