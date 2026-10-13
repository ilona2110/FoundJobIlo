import "server-only";
import type { Scraper, ScrapedOffre, ScrapeCriteria, ProgressEvent } from "../base";
import { htmlToText } from "../base";
import { parseDocument, largestTextBlockHtml, extractJobPostingLd, BROWSER_HEADERS, sleep } from "../dom";
import { detectVie } from "@/lib/vie";
import { isInHauteGaronne, ZONE_SEARCH_CITIES } from "@/lib/geo/haute-garonne";
import { CAREERS_MAX_PER_COMPANY } from "./workday-parse";

// Safran : safran-group.com/fr/offres est rendu côté serveur (12 offres par page,
// pagination « page » à partir de 0, recherche plein texte « search »). On recherche
// chaque grande ville du 31, puis on lit chaque offre et on garde celles dont le champ
// « Emplacement » est en Haute-Garonne.
const SOURCE = "safran";
const BASE = "https://www.safran-group.com";
const MAX_PAGES = 15;

/** Liens d'offres d'une page de résultats : /fr/offres/{pays}/{ville}/{titre}-{id}. */
export function parseSafranListing(html: string): string[] {
  const doc = parseDocument(html);
  const out = new Set<string>();
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    const m = href.match(/^(?:https:\/\/www\.safran-group\.com)?(\/fr\/offres\/[a-z-]+\/[a-z0-9-]+\/[a-z0-9-]+-\d+)\/?(?:[?#].*)?$/);
    if (m) out.add(`${BASE}${m[1]}`);
  }
  return Array.from(out);
}

/** Valeur d'un libellé « Emplacement : … », que valeur et libellé soient dans le même élément ou deux voisins. */
export function labeledValue(doc: Document, label: string): string | null {
  const re = new RegExp(`^${label}\\s*:?\\s*(.*)$`, "i");
  let best: string | null = null;
  for (const el of Array.from(doc.querySelectorAll("li, p, span, div, dt, dd, td, th, strong"))) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length > 200) continue;
    const m = text.match(re);
    if (!m) continue;
    let value = m[1].trim();
    if (!value) value = (el.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (value && (!best || value.length < best.length)) best = value;
  }
  return best;
}

function descriptionHtml(doc: Document): string | null {
  const heading = Array.from(doc.querySelectorAll("h1, h2, h3, h4")).find((h) =>
    /parlons de votre future mission/i.test(h.textContent ?? "")
  );
  if (heading) {
    let el: Element | null = heading.parentElement;
    while (el && el !== doc.body) {
      const text = el.textContent ?? "";
      if (/parlons de vous/i.test(text) && text.length < 25000) return el.innerHTML;
      el = el.parentElement;
    }
  }
  return extractJobPostingLd(doc)?.description_html ?? largestTextBlockHtml(doc, 300);
}

export function parseSafranDetail(url: string, html: string): ScrapedOffre | null {
  const doc = parseDocument(html);
  const location = labeledValue(doc, "Emplacement");
  if (!isInHauteGaronne(location)) return null;
  const title = (doc.querySelector("h1")?.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!title) return null;
  const descHtml = descriptionHtml(doc) ?? "";
  const text = htmlToText(descHtml);
  const published = (doc.body?.textContent ?? "").match(/Publié\s+(?:le\s+)?(\d{2})[./](\d{2})[./](\d{4})/);
  const id = url.match(/-(\d+)\/?$/)?.[1] ?? url;
  return {
    source_id: id,
    url,
    title,
    company: labeledValue(doc, "Société") || "Safran",
    country: "France",
    location,
    contract_type: labeledValue(doc, "Type de contrat"),
    salary: null,
    description_html: descHtml,
    description_text: text,
    description_status: text.length >= 100 ? "ok" : "failed",
    posted_at: published ? `${published[3]}-${published[2]}-${published[1]}` : null,
    is_vie: detectVie({ source: SOURCE, title, description: text, url }),
    raw_payload: { id },
    scrape_errors: text.length >= 100 ? undefined : "description introuvable",
  };
}

export const safranScraper: Scraper = {
  name: SOURCE,
  async *scrape(_criteria: ScrapeCriteria, onEvent: (e: ProgressEvent) => void) {
    onEvent({ kind: "start", source: SOURCE });
    const urls = new Set<string>();
    for (const city of ZONE_SEARCH_CITIES.slice(0, 8)) {
      for (let page = 0; page < MAX_PAGES && urls.size < CAREERS_MAX_PER_COMPANY; page++) {
        const params = new URLSearchParams({ search: city, page: String(page) });
        const res = await fetch(`${BASE}/fr/offres?${params}`, { headers: BROWSER_HEADERS });
        if (!res.ok) {
          if (urls.size === 0 && page === 0 && city === ZONE_SEARCH_CITIES[0]) {
            throw new Error(`Safran : HTTP ${res.status}`);
          }
          break;
        }
        const found = parseSafranListing(await res.text());
        const before = urls.size;
        for (const u of found) urls.add(u);
        if (!found.length || urls.size === before) break;
        await sleep(700);
      }
    }

    const list = Array.from(urls).slice(0, CAREERS_MAX_PER_COMPANY);
    onEvent({ kind: "list", source: SOURCE, total: list.length });
    let ok = 0;
    let failed = 0;
    let consecutiveFails = 0;
    for (let i = 0; i < list.length; i++) {
      let status: "ok" | "failed" = "failed";
      try {
        const res = await fetch(list[i], { headers: BROWSER_HEADERS });
        if (res.ok) {
          const offre = parseSafranDetail(list[i], await res.text());
          if (offre) {
            yield offre;
            status = offre.description_status === "ok" ? "ok" : "failed";
          } else {
            status = "ok"; // offre lue, hors Haute-Garonne : ignorée
          }
        }
      } catch {
        status = "failed";
      }
      if (status === "ok") {
        ok++;
        consecutiveFails = 0;
      } else {
        failed++;
        consecutiveFails++;
      }
      onEvent({ kind: "offre", source: SOURCE, index: i + 1, total: list.length, status });
      if (consecutiveFails >= 10) break;
      await sleep(600 + Math.random() * 400);
    }
    onEvent({ kind: "done", source: SOURCE, seen: list.length, ok, failed });
  },
};
