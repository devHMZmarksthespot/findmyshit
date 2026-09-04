"use client";

import { useState } from "react";
import type { Criteria, RankedListing, SearchEvent, Source } from "@/lib/types";

const EXAMPLE =
  "Ich suche einen Beizentisch mit Original Horgen-Glarus Füssen, Grösse 71 auf 70 cm, mit Eichenplatte.";

const SOURCE_LABEL: Record<Source, string> = { tutti: "Tutti", ricardo: "Ricardo" };

export default function Home() {
  const [description, setDescription] = useState(EXAMPLE);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [criteria, setCriteria] = useState<Criteria | null>(null);
  const [collected, setCollected] = useState<{ total: number; bySource: Record<Source, number>; queries: string[] } | null>(null);
  const [results, setResults] = useState<RankedListing[] | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setLog([]);
    setWarnings([]);
    setCriteria(null);
    setCollected(null);
    setResults(null);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line) as SearchEvent);
      }
      if (buf.trim()) handle(JSON.parse(buf) as SearchEvent);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function handle(ev: SearchEvent) {
    switch (ev.type) {
      case "status":
        setLog((l) => [...l, ev.message]);
        break;
      case "warning":
        setWarnings((w) => [...w, ev.message]);
        break;
      case "criteria":
        setCriteria(ev.criteria);
        break;
      case "collected":
        setCollected({ total: ev.total, bySource: ev.bySource, queries: ev.queries });
        break;
      case "results":
        setResults(ev.results);
        break;
      case "error":
        setError(ev.message);
        break;
    }
  }

  const matches = results?.filter((r) => r.assessment.verdict === "match") ?? [];
  const possible = results?.filter((r) => r.assessment.verdict === "possible") ?? [];
  const rejected = results?.filter((r) => r.assessment.verdict === "no") ?? [];

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">findmyshit</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">
          Beschreib genau, was du suchst. Wir sammeln auf Tutti und Ricardo breit ein und prüfen jedes Inserat streng
          gegen deine Kriterien.
        </p>
      </header>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <textarea
          className="w-full resize-y rounded-lg border border-neutral-300 bg-transparent p-3 text-base outline-none focus:border-neutral-500 dark:border-neutral-700"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={running}
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={run}
            disabled={running || description.trim().length < 5}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {running ? "Suche läuft …" : "Suchen"}
          </button>
          {log.length > 0 && <span className="text-sm text-neutral-500">{log[log.length - 1]}</span>}
        </div>
      </section>

      {error && (
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {criteria && (
        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            <h2 className="mb-2 font-medium">Verstandene Kriterien</h2>
            <dl className="space-y-1">
              <Row k="Objekt" v={criteria.objectType} />
              {criteria.brand && <Row k="Marke" v={criteria.brand} />}
              {criteria.materials.length > 0 && <Row k="Material" v={criteria.materials.join(", ")} />}
              <Row
                k="Masse"
                v={
                  [
                    criteria.dimensionsCm.length && `L ${criteria.dimensionsCm.length}`,
                    criteria.dimensionsCm.width && `B ${criteria.dimensionsCm.width}`,
                    criteria.dimensionsCm.height && `H ${criteria.dimensionsCm.height}`,
                  ]
                    .filter(Boolean)
                    .join(" × ") + ` cm (± ${criteria.dimensionsCm.toleranceCm})`
                }
              />
              <Row k="Muss" v={criteria.mustHave.join(" · ")} />
              {criteria.niceToHave.length > 0 && <Row k="Kann" v={criteria.niceToHave.join(" · ")} />}
            </dl>
          </div>
          <div className="rounded-xl border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            <h2 className="mb-2 font-medium">Suchlauf</h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              Suchbegriffe: {(collected?.queries ?? criteria.searchQueries).map((q) => `„${q}“`).join(", ")}
            </p>
            {collected && (
              <p className="mt-2">
                {collected.total} Inserate eingesammelt (Tutti {collected.bySource.tutti}, Ricardo{" "}
                {collected.bySource.ricardo})
              </p>
            )}
            <ul className="mt-2 space-y-1 text-neutral-500">
              {log.map((l, i) => (
                <li key={i}>· {l}</li>
              ))}
            </ul>
            {warnings.length > 0 && (
              <ul className="mt-2 space-y-1 text-amber-700 dark:text-amber-400">
                {warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {results && (
        <section className="mt-8 space-y-8">
          <Group title={`Treffer (${matches.length})`} items={matches} empty="Kein Inserat erfüllt alle Muss-Kriterien belegbar." />
          <Group
            title={`Möglich, Infos fehlen (${possible.length})`}
            items={possible}
            empty="Keine unklaren Kandidaten."
          />
          <div>
            <button
              onClick={() => setShowRejected((s) => !s)}
              className="text-sm text-neutral-500 underline-offset-2 hover:underline"
            >
              {showRejected ? "Aussortierte ausblenden" : `Aussortierte anzeigen (${rejected.length})`}
            </button>
            {showRejected && <Group title="" items={rejected} empty="" compact />}
          </div>
        </section>
      )}
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-neutral-500">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Group({
  title,
  items,
  empty,
  compact = false,
}: {
  title: string;
  items: RankedListing[];
  empty: string;
  compact?: boolean;
}) {
  return (
    <div>
      {title && <h2 className="mb-3 text-lg font-medium">{title}</h2>}
      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <Card key={r.key} r={r} compact={compact} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Card({ r, compact }: { r: RankedListing; compact: boolean }) {
  const a = r.assessment;
  const tone =
    a.verdict === "match"
      ? "border-emerald-300 dark:border-emerald-800"
      : a.verdict === "possible"
        ? "border-amber-300 dark:border-amber-800"
        : "border-neutral-200 dark:border-neutral-800";
  return (
    <li className={`flex gap-4 rounded-xl border bg-white p-3 dark:bg-neutral-900 ${tone}`}>
      {r.image && !compact && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.image} alt="" className="h-24 w-32 shrink-0 rounded-lg object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
            {r.title}
          </a>
          <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs tabular-nums dark:bg-neutral-800">
            {a.score}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-neutral-500">
          {SOURCE_LABEL[r.source]}
          {r.price ? ` · ${r.price}` : ""}
          {r.location ? ` · ${r.location}` : ""}
          {r.detailChecked ? " · Detailseite geprüft" : ""}
        </p>
        {!compact && (
          <>
            <ul className="mt-2 space-y-0.5 text-sm">
              {a.reasons.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            {a.evidence && (
              <p className="mt-1 text-sm italic text-neutral-600 dark:text-neutral-400">„{a.evidence}“</p>
            )}
            {a.missingInfo.length > 0 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Fehlt: {a.missingInfo.join(", ")}</p>
            )}
          </>
        )}
        {compact && a.reasons[0] && <p className="mt-1 text-sm text-neutral-500">{a.reasons[0]}</p>}
      </div>
    </li>
  );
}
