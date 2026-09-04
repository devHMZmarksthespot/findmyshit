import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Format = "rawHtml" | "markdown";

/** Firecrawl-Pläne erlauben nur wenige parallele Scrapes (Hobby: 2). Alles darüber wird hier in eine Warteschlange gestellt. */
const MAX_PARALLEL = Number(process.env.FIRECRAWL_CONCURRENCY ?? 2);
let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/**
 * Holt eine Seite über Firecrawl (nötig für Ricardo wegen Captcha).
 * Bevorzugt das SDK mit FIRECRAWL_API_KEY, fällt sonst auf die lokal
 * eingeloggte `firecrawl`-CLI zurück.
 */
export function firecrawlScrape(url: string, format: Format): Promise<string> {
  return withSlot(() => scrapeOnce(url, format));
}

async function scrapeOnce(url: string, format: Format): Promise<string> {
  // Anführungszeichen und Leerraum abfangen, die beim Einfügen in Vercel/.env leicht mitkommen.
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim().replace(/^["']|["']$/g, "");
  if (apiKey) {
    const { default: Firecrawl } = await import("@mendable/firecrawl-js");
    const app = new Firecrawl({ apiKey });
    const doc = await withRateLimitRetry(
      () => app.scrape(url, { formats: [format] }) as Promise<Record<string, unknown>>,
    );
    const content = doc[format];
    if (typeof content !== "string") throw new Error(`Firecrawl lieferte kein ${format} für ${url}`);
    return content;
  }
  return scrapeViaCli(url, format);
}

const MAX_ATTEMPTS = 4;
const MAX_WAIT_MS = 65_000;

/**
 * Firecrawl-Pläne haben ein Limit pro Minute (Hobby: ~10 Anfragen). Bei 429 wird
 * die von Firecrawl genannte Wartezeit ("retry after 43s") abgewartet und erneut
 * versucht. Andere Fehler werden sofort weitergereicht.
 */
export async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unauthorized|invalid token|\b401\b/i.test(msg)) {
        throw new Error(
          `Firecrawl lehnt den Key ab (${msg}). FIRECRAWL_API_KEY prüfen: beginnt mit "fc-", ohne Anführungszeichen, danach neu deployen.`,
        );
      }
      const rateLimited = /rate limit|\b429\b/i.test(msg);
      if (!rateLimited || attempt >= MAX_ATTEMPTS) throw err;
      const seconds = Number(msg.match(/retry after (\d+)\s*s/i)?.[1] ?? 30);
      const waitMs = Math.min(MAX_WAIT_MS, (seconds + 2) * 1000);
      // Slot freigeben, damit andere Abrufe nicht hinter dem Wartenden hängen.
      await releaseSlotWhile(waitMs);
    }
  }
}

async function releaseSlotWhile(ms: number): Promise<void> {
  active--;
  waiting.shift()?.();
  await new Promise((r) => setTimeout(r, ms));
  if (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

async function scrapeViaCli(url: string, format: Format): Promise<string> {
  const out = path.join(os.tmpdir(), `fc-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  try {
    await execFileAsync("firecrawl", ["scrape", url, "--format", format, "-o", out], {
      timeout: 90_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return await fs.readFile(out, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Firecrawl-CLI fehlgeschlagen (${msg}). Entweder FIRECRAWL_API_KEY in .env.local setzen oder \`firecrawl login\` ausführen.`,
    );
  } finally {
    fs.unlink(out).catch(() => {});
  }
}
