import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Assessment, Criteria, Listing } from "./types";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY fehlt. Bitte in .env.local eintragen (siehe .env.example).");
  }
  return (_client ??= new Anthropic());
}

const CriteriaSchema = z.object({
  objectType: z.string().describe("Was gesucht wird, z.B. 'Beizentisch'"),
  brand: z.string().nullable().describe("Hersteller/Marke oder null"),
  materials: z.array(z.string()).describe("Geforderte Materialien, z.B. ['Eiche']"),
  dimensionsCm: z.object({
    length: z.number().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    toleranceCm: z.number().describe("Akzeptable Abweichung in cm, Standard 3"),
  }),
  mustHave: z.array(z.string()).describe("Harte Kriterien, jedes als kurzer Satz"),
  niceToHave: z.array(z.string()),
  searchQueries: z
    .array(z.string())
    .describe("3 bis 6 kurze Suchbegriffe (1 bis 3 Wörter), wie man sie in Tutti/Ricardo tippen würde, inkl. Synonyme"),
});

export async function extractCriteria(description: string): Promise<Criteria> {
  const res = await client().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: [
      "Du hilfst, Schweizer Kleinanzeigen (Tutti.ch, Ricardo.ch) präzise zu durchsuchen.",
      "Zerlege die Beschreibung des Nutzers in prüfbare Kriterien.",
      "Masse: '71 auf 70' bedeutet Tischplatte 71 x 70 cm (Länge x Breite). Höhe nur wenn genannt.",
      "Suchbegriffe: breit denken. Für einen Beizentisch mit Horgen-Glarus-Füssen wären das z.B. 'Beizentisch', 'Horgen Glarus Tisch', 'Bistrotisch Gussfüsse', 'Horgen Glarus'.",
      "Keine Masse in die Suchbegriffe, die Plattformen matchen nur Titel-Keywords.",
    ].join("\n"),
    messages: [{ role: "user", content: description }],
    output_config: { format: zodOutputFormat(CriteriaSchema), effort: "medium" },
  });
  if (!res.parsed_output) throw new Error("Kriterien konnten nicht extrahiert werden.");
  return res.parsed_output;
}

const AssessmentSchema = z.object({
  results: z.array(
    z.object({
      key: z.string().describe("Exakt der key des Inserats"),
      score: z.number().describe("0 bis 100: Wahrscheinlichkeit, dass das Inserat das Gesuchte ist"),
      verdict: z.enum(["match", "possible", "no"]),
      reasons: z.array(z.string()).describe("1 bis 3 kurze Sätze, deutsch"),
      evidence: z.string().describe("Wörtliches Zitat aus Titel/Beschreibung, das die Einschätzung belegt, oder leer"),
      missingInfo: z.array(z.string()).describe("Was das Inserat nicht verrät, aber für die Entscheidung nötig wäre"),
    }),
  ),
});

function listingToText(l: Listing): string {
  const attrs = Object.entries(l.attributes)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return [
    `key: ${l.key}`,
    `Quelle: ${l.source}`,
    `Titel: ${l.title}`,
    l.price ? `Preis: ${l.price}` : null,
    attrs ? `Attribute: ${attrs}` : null,
    `Beschreibung: ${l.body ? l.body.replace(/\s+/g, " ").slice(0, 2500) : "(keine Beschreibung auf der Suchseite)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const RANK_SYSTEM = [
  "Du bewertest Kleinanzeigen streng gegen die Suchkriterien eines Nutzers. Antworte auf Deutsch.",
  "Regeln:",
  "- Falscher Objekttyp (z.B. Stuhl, Bücherregal, nur Füsse ohne Platte, nur Platte ohne Füsse) => verdict 'no', score unter 10.",
  "- Masse: vergleiche Länge/Breite mit Toleranz. Schreibweisen wie '70x70', '70/71', '71 auf 70', '700x700 mm' erkennen. Reihenfolge Länge/Breite ist egal.",
  "- Klar abweichende Masse (mehr als die Toleranz) bei einem Muss-Kriterium => 'no'.",
  "- Alle Muss-Kriterien belegt => 'match', score 80 bis 100.",
  "- Objekttyp passt, aber Muss-Kriterien nicht belegbar (Inserat schweigt dazu) => 'possible', score 30 bis 70. Liste fehlende Infos auf.",
  "- Bei Inseraten ohne Beschreibung nur nach Titel und Attributen urteilen und fehlende Infos auflisten.",
  "- 'Original Horgen Glarus Füsse' gilt als belegt, wenn Horgen Glarus, Horgen-Glarus, HG, Baumann Horgen oder Modellnummern wie No. 301 genannt werden; Nachbauten oder 'im Stil von' gelten nicht.",
  "- evidence ist ein wörtliches Zitat, keine Umschreibung.",
  "Gib für jedes Inserat genau einen Eintrag zurück, mit exakt demselben key.",
].join("\n");

export async function assessListings(criteria: Criteria, listings: Listing[]): Promise<Assessment[]> {
  if (listings.length === 0) return [];
  const res = await client().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: [{ type: "text", text: RANK_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          "SUCHKRITERIEN:",
          JSON.stringify(criteria, null, 2),
          "",
          `INSERATE (${listings.length}):`,
          listings.map(listingToText).join("\n\n---\n\n"),
        ].join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(AssessmentSchema), effort: "medium" },
  });
  if (!res.parsed_output) throw new Error("Bewertung konnte nicht geparst werden.");
  const known = new Set(listings.map((l) => l.key));
  return res.parsed_output.results.filter((r) => known.has(r.key));
}
