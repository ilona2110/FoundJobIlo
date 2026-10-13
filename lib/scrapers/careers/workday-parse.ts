// Fonctions pures des scrapers « sites carrières » (testables sans réseau).
import { isInHauteGaronne } from "@/lib/geo/haute-garonne";

/** Plafond d'offres lues par entreprise et par scan (une requête détail par offre). */
export const CAREERS_MAX_PER_COMPANY = 300;

export const CAREERS_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  accept: "application/json",
  "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
};

export type WorkdayFacetValue = {
  descriptor?: string;
  id?: string;
  count?: number;
  facetParameter?: string;
  values?: WorkdayFacetValue[];
};

export type WorkdayFacet = {
  facetParameter?: string;
  descriptor?: string;
  values?: WorkdayFacetValue[];
};

export type ZoneFacets = { parameter: string; ids: string[]; labels: string[] };

/**
 * Cherche, dans les filtres renvoyés par Workday, les valeurs de lieu situées en
 * Haute-Garonne (« Toulouse », « Blagnac », « France - Colomiers »…). Les filtres peuvent
 * être imbriqués (groupe « Locations » → « locations » / « locationCountry »). On garde
 * le paramètre qui regroupe le plus de valeurs du 31 : appliquer plusieurs paramètres
 * à la fois ferait une intersection, et des offres seraient perdues.
 */
export function findZoneFacets(facets: WorkdayFacet[]): ZoneFacets | null {
  const found = new Map<string, { ids: string[]; labels: string[] }>();
  const walk = (parameter: string | undefined, values: WorkdayFacetValue[] | undefined) => {
    for (const v of values ?? []) {
      if (v.facetParameter && v.values?.length) {
        walk(v.facetParameter, v.values);
        continue;
      }
      if (!parameter || !v.id || !v.descriptor) continue;
      if (!isInHauteGaronne(v.descriptor)) continue;
      const entry = found.get(parameter) ?? { ids: [], labels: [] };
      if (!entry.ids.includes(v.id)) {
        entry.ids.push(v.id);
        entry.labels.push(v.descriptor);
      }
      found.set(parameter, entry);
    }
  };
  for (const f of facets) walk(f.facetParameter, f.values);

  let best: ZoneFacets | null = null;
  for (const [parameter, e] of found) {
    if (!best || e.ids.length > best.ids.length) best = { parameter, ...e };
  }
  return best;
}
