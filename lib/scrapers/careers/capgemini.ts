import "server-only";
import type { Scraper, ScrapedOffre, ScrapeCriteria, ProgressEvent } from "../base";
import { htmlToText } from "../base";
import { sleep } from "../dom";
import { detectVie } from "@/lib/vie";
import { keepInZone } from "@/lib/geo/zone-policy";
import { CAREERS_HEADERS, CAREERS_MAX_PER_COMPANY } from "./workday-parse";

// Capgemini (dont Capgemini Engineering, Invent…) : le moteur de recherche de
// capgemini.com/fr-fr/carrieres interroge cette API JSON publique, qui renvoie la
// description complète de chaque offre — aucune requête détail n'est nécessaire.
const SOURCE = "capgemini";
const API = "https://cg-job-search-microservices.azurewebsites.net/api/job-search";
const PAGE_SIZE = 50;
/** Le paramètre « location » de l'API couvre aussi les communes voisines (Toulouse → Blagnac). */
const LOCATIONS = ["Toulouse", "Blagnac", "Colomiers", "Labège"];

export type CapgeminiJob = {
  id?: string;
  title?: string;
  brand?: string;
  contract_type?: string;
  description?: string;
  description_stripped?: string;
  location?: string;
  apply_job_url?: string;
  indexed_at?: string;
  updated_at?: string;
  experience_level?: string;
};

export function capgeminiJobToOffre(j: CapgeminiJob): ScrapedOffre | null {
  const id = (j.id ?? "").trim();
  const title = (j.title ?? "").trim();
  if (!id || !title) return null;
  const html = j.description ?? "";
  const text = htmlToText(html) || (j.description_stripped ?? "");
  if (!keepInZone({ location: j.location ?? null, title, description_text: text, contract_type: j.contract_type })) return null;
  const url = j.apply_job_url || `https://www.capgemini.com/fr-fr/carrieres/`;
  const date = (j.indexed_at || j.updated_at || "").slice(0, 10);
  return {
    source_id: id,
    url,
    title,
    company: j.brand?.trim() || "Capgemini",
    country: "France",
    location: j.location ?? null,
    contract_type: j.contract_type || null,
    salary: null,
    description_html: html,
    description_text: text,
    description_status: text.length >= 100 ? "ok" : "failed",
    posted_at: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    is_vie: detectVie({ source: SOURCE, title, description: text, url }),
    raw_payload: { id, experience_level: j.experience_level },
    scrape_errors: text.length >= 100 ? undefined : "description vide",
  };
}

async function fetchPage(location: string, page: number): Promise<{ count: number; data: CapgeminiJob[] }> {
  const params = new URLSearchParams({
    page: String(page),
    size: String(PAGE_SIZE),
    country_code: "fr-fr",
    location,
  });
  const res = await fetch(`${API}?${params}`, { headers: CAREERS_HEADERS });
  if (!res.ok) throw new Error(`Capgemini : HTTP ${res.status}`);
  const json = (await res.json()) as { count?: number; data?: CapgeminiJob[] };
  return { count: json.count ?? 0, data: json.data ?? [] };
}

export const capgeminiScraper: Scraper = {
  name: SOURCE,
  async *scrape(_criteria: ScrapeCriteria, onEvent: (e: ProgressEvent) => void) {
    onEvent({ kind: "start", source: SOURCE });
    const offres = new Map<string, ScrapedOffre>();
    for (const location of LOCATIONS) {
      for (let page = 1; page <= 20 && offres.size < CAREERS_MAX_PER_COMPANY; page++) {
        const { count, data } = await fetchPage(location, page);
        for (const j of data) {
          const o = capgeminiJobToOffre(j);
          if (o && !offres.has(o.source_id)) offres.set(o.source_id, o);
        }
        if (data.length < PAGE_SIZE || page * PAGE_SIZE >= count) break;
        await sleep(300);
      }
    }
    const list = Array.from(offres.values()).slice(0, CAREERS_MAX_PER_COMPANY);
    onEvent({ kind: "list", source: SOURCE, total: list.length });
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      yield list[i];
      const status = list[i].description_status === "ok" ? "ok" : "failed";
      if (status === "ok") ok++;
      else failed++;
      onEvent({ kind: "offre", source: SOURCE, index: i + 1, total: list.length, status });
    }
    onEvent({ kind: "done", source: SOURCE, seen: list.length, ok, failed });
  },
};
