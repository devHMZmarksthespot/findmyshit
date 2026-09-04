# findmyshit

Präzisionssuche für Schweizer Kleinanzeigen (Tutti.ch, Ricardo.ch). Du beschreibst das gesuchte Objekt in einem Satz, die App sammelt breit ein und lässt Claude jedes Inserat streng gegen deine Kriterien prüfen.

## Ablauf

1. Claude zerlegt die Beschreibung in Kriterien (Objekttyp, Marke, Masse mit Toleranz, Material, Muss/Kann) und erzeugt Suchbegriffe.
2. Tutti wird direkt per HTTP abgefragt, Ricardo über Firecrawl (Captcha-Schutz).
3. Claude bewertet den deduplizierten Pool. Für aussichtsreiche Ricardo-Kandidaten wird die Artikelseite nachgeladen und neu bewertet.

## Lokal starten

```bash
cp .env.example .env.local   # ANTHROPIC_API_KEY eintragen
npm install
npm run dev                  # http://localhost:3000
```

Für Ricardo braucht es entweder `FIRECRAWL_API_KEY` oder eine lokal eingeloggte `firecrawl`-CLI. Auf Vercel ist der Key Pflicht.

Tutti blockt Rechenzentrums-IPs (Vercel) mit 403. In dem Fall weicht die App automatisch auf Firecrawl aus. Ein Suchlauf kostet dann etwa 15 bis 25 Firecrawl-Credits (Tutti bis 10, Ricardo 5, Detailseiten bis 8), lokal nur 5 bis 13.

## Umgebungsvariablen

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `ANTHROPIC_API_KEY` | ja | Claude-API-Key |
| `FIRECRAWL_API_KEY` | auf Vercel ja | Firecrawl für Ricardo, lokal optional (CLI-Fallback) |
| `CLAUDE_MODEL` | nein | Standard `claude-opus-5` |
