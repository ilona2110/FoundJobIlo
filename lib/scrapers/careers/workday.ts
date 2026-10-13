import "server-only";
import type { Scraper, ScrapedOffre, ScrapeCriteria, ProgressEvent } from "../base";
import { htmlToText } from "../base";
import { sleep } from "../dom";
import { detectVie } from "@/lib/vie";
import { isInHauteGaronne, ZONE_SEARCH_CITIES } from "@/lib/geo/haute-garonne";
import { keepInZone } from "@/lib/geo/zone-policy";
import {
  CAREERS_MAX_PER_COMPANY,
  CAREERS_HEADERS,
  findZoneFacets,
  type WorkdayFacet,
} from "./workday-parse";

// Sites carrières hébergés par Workday (Airbus, Thales, Renault Group, Accenture…).
// Workday expose, derrière chaque site carrières, une API JSON publique (« CXS ») :
//   POST https://{hôte}/wday/cxs/{tenant}/{site}/jobs        → liste paginée (20 max par page) + filtres
//   GET  https://{hôte}/wday/cxs/{tenant}/{site}{externalPath} → détail d'une offre
// Le filtre de lieu Workday (« facette ») est choisi automatiquement parmi les valeurs
// qui désignent une commune de Haute-Garonne ; à défaut, recherche par nom de ville.

export type WorkdaySite = {
  /** Identifiant de la source dans JobScout (« airbus »). */
  id: string;
  /** Nom affiché si Workday ne précise pas l'entité qui recrute. */
  company: string;
  /** « ag.wd3.myworkdayjobs.com » */
  host: string;
  tenant: string;
  site: string;
};

const PAGE_SIZE = 20;

type WorkdayListResponse = {
  total?: number;
  jobPostings?: { title?: string; externalPath?: string; locationsText?: string; postedOn?: string }[];
  facets?: WorkdayFacet[];
};

type WorkdayDetail = {
  jobPostingInfo?: {
    id?: string;
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    startDate?: string;
    postedOn?: string;
    timeType?: string;
    jobReqId?: string;
    externalUrl?: string;
    country?: { descriptor?: string };
  };
  hiringOrganization?: { name?: string };
};

async function postJobs(
  s: WorkdaySite,
  body: { appliedFacets: Record<string, string[]>; searchText: string; offset: number; limit: number }
): Promise<WorkdayListResponse> {
  const res = await fetch(`https://${s.host}/wday/cxs/${s.tenant}/${s.site}/jobs`, {
    method: "POST",
    headers: { ...CAREERS_HEADERS, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${s.company} (Workday) : HTTP ${res.status}`);
  return (await res.json()) as WorkdayListResponse;
}

async function getDetail(s: WorkdaySite, externalPath: string): Promise<WorkdayDetail | null> {
  const res = await fetch(`https://${s.host}/wday/cxs/${s.tenant}/${s.site}${externalPath}`, {
    headers: CAREERS_HEADERS,
  });
  if (!res.ok) return null;
  return (await res.json()) as WorkdayDetail;
}

/** « 3 Locations », « 2 emplacements » : lieu à vérifier dans le détail. */
function isMultiLocation(text: string): boolean {
  return /^\s*\d+\s+(locations?|emplacements?|lieux|sites?)\s*$/i.test(text);
}

async function collectPaths(
  s: WorkdaySite,
  priorityKeywords: string[],
  log: (msg: string) => void
): Promise<string[]> {
  const first = await postJobs(s, { appliedFacets: {}, searchText: "", offset: 0, limit: PAGE_SIZE });
  const zone = findZoneFacets(first.facets ?? []);
  const paths = new Map<string, string>();

  const runQuery = async (appliedFacets: Record<string, string[]>, searchText: string, maxPages = 100) => {
    for (
      let offset = 0;
      offset < maxPages * PAGE_SIZE && paths.size < CAREERS_MAX_PER_COMPANY;
      offset += PAGE_SIZE
    ) {
      const page = await postJobs(s, { appliedFacets, searchText, offset, limit: PAGE_SIZE });
      const postings = page.jobPostings ?? [];
      for (const p of postings) {
        if (!p.externalPath || paths.has(p.externalPath)) continue;
        const where = p.locationsText ?? "";
        // Écarte tout de suite les offres clairement ailleurs (évite un appel détail inutile).
        // (Un graduate programme au lieu générique, « France », est gardé : voir zone-policy.)
        if (where && !isMultiLocation(where) && !keepInZone({ location: where, title: p.title ?? "" })) continue;
        paths.set(p.externalPath, where);
        if (paths.size >= CAREERS_MAX_PER_COMPANY) break;
      }
      if (postings.length < PAGE_SIZE) break;
      if (typeof page.total === "number" && offset + PAGE_SIZE >= page.total) break;
      await sleep(250);
    }
  };

  // Mots-clés prioritaires (« graduate ») d'abord, pour qu'ils ne soient jamais coupés
  // par le plafond d'offres : dans la zone, puis partout (programmes au lieu générique).
  for (const kw of priorityKeywords) {
    if (zone) await runQuery({ [zone.parameter]: zone.ids }, kw);
    await runQuery({}, kw, 5);
  }

  if (zone) {
    log(`filtre Workday « ${zone.parameter} » : ${zone.labels.join(", ")}`);
    await runQuery({ [zone.parameter]: zone.ids }, "");
  } else {
    // Pas de filtre de lieu exploitable : recherche plein texte sur les principales villes du 31.
    for (const city of ZONE_SEARCH_CITIES.slice(0, 6)) {
      if (paths.size >= CAREERS_MAX_PER_COMPANY) break;
      await runQuery({}, city);
    }
  }
  return Array.from(paths.keys());
}

export function detailToOffre(s: WorkdaySite, path: string, d: WorkdayDetail): ScrapedOffre | null {
  const info = d.jobPostingInfo;
  if (!info?.title) return null;
  const locations = [info.location, ...(info.additionalLocations ?? [])].filter(
    (l): l is string => !!l && l.trim().length > 0
  );
  const html = info.jobDescription ?? "";
  const text = htmlToText(html);
  const inZone = locations.filter((l) => isInHauteGaronne(l));
  const where = inZone.length ? inZone.join(" · ") : locations.join(", ") || null;
  if (!inZone.length && !keepInZone({ location: where, title: info.title, description_text: text })) return null;

  const url = info.externalUrl || `https://${s.host}/fr-FR/${s.site}${path}`;
  return {
    source_id: info.jobReqId || info.id || path,
    url,
    title: info.title.trim(),
    company: d.hiringOrganization?.name?.trim() || s.company,
    country: "France",
    location: where,
    contract_type: null,
    salary: null,
    description_html: html,
    description_text: text,
    description_status: text.length >= 100 ? "ok" : "failed",
    posted_at: /^\d{4}-\d{2}-\d{2}/.test(info.startDate ?? "") ? info.startDate!.slice(0, 10) : null,
    is_vie: detectVie({ source: s.id, title: info.title, description: text, url }),
    raw_payload: { externalPath: path, jobReqId: info.jobReqId, timeType: info.timeType },
    scrape_errors: text.length >= 100 ? undefined : "description vide",
  };
}

export function createWorkdayScraper(s: WorkdaySite): Scraper {
  return {
    name: s.id,
    async *scrape(criteria: ScrapeCriteria, onEvent: (e: ProgressEvent) => void) {
      onEvent({ kind: "start", source: s.id });
      const paths = await collectPaths(s, criteria.priorityKeywords ?? [], (msg) => console.log(`[${s.id}] ${msg}`));
      onEvent({ kind: "list", source: s.id, total: paths.length });

      let ok = 0;
      let failed = 0;
      let consecutiveFails = 0;
      for (let i = 0; i < paths.length; i++) {
        let status: "ok" | "failed" = "failed";
        try {
          const d = await getDetail(s, paths[i]);
          const offre = d ? detailToOffre(s, paths[i], d) : null;
          if (offre) {
            yield offre;
            status = offre.description_status === "ok" ? "ok" : "failed";
          } else if (d) {
            // Offre lue mais hors Haute-Garonne (lieu précisé dans le détail) : ni succès ni échec.
            onEvent({ kind: "offre", source: s.id, index: i + 1, total: paths.length, status: "ok" });
            consecutiveFails = 0;
            await sleep(200);
            continue;
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
        onEvent({ kind: "offre", source: s.id, index: i + 1, total: paths.length, status });
        if (consecutiveFails >= 10) break;
        await sleep(200);
      }
      onEvent({ kind: "done", source: s.id, seen: paths.length, ok, failed });
    },
  };
}
