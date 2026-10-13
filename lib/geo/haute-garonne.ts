// Zone de recherche : Haute-Garonne (31).
// Importable côté client ET serveur (pas de "server-only") : utilisé par l'orchestrateur
// de scan, les scrapers et les tests.
//
// isInHauteGaronne() décide, à partir du libellé de lieu d'une offre (« Toulouse, Occitanie,
// France », « 31 - BLAGNAC », « Colomiers (31) », « 31700 Blagnac »…), si l'offre se trouve
// en Haute-Garonne. En cas de doute (lieu vide, homonyme sans contexte), l'offre est écartée :
// l'utilisatrice ne veut QUE des offres en Haute-Garonne.

import { HAUTE_GARONNE_COMMUNES } from "./haute-garonne-communes";
import type { ZoneArea } from "./areas";

export type { ZoneArea } from "./areas";

export const ZONE_LABEL = "Haute-Garonne";
export const ZONE_DEPARTEMENT = "31";

/**
 * Communes les plus peuplées, dans l'ordre : utilisées comme mots-clés de lieu par les
 * sites carrières qui ne filtrent que par texte libre.
 */
export const ZONE_SEARCH_CITIES = HAUTE_GARONNE_COMMUNES.filter(([, , homonym]) => !homonym)
  .slice()
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .map(([name]) => name);

/**
 * Noms de communes trop ambigus pour être reconnus au milieu d'un texte (mot courant,
 * début d'un nom de commune plus long ailleurs en France) : reconnus seulement quand
 * ils forment à eux seuls un élément du lieu (« Grenade, France » oui, « Grenade (Espagne) » non).
 */
const EXACT_ONLY = new Set([
  "grenade",
  "l union",
  "saint jean",
  "vernet",
  "aigrefeuille",
  "lanta",
  "larra",
  "daux",
  "villate",
  "flourens",
  "caraman",
  "deyme",
  "mauzac",
  "launac",
]);

/** Mots qui, juste après un nom de commune, signalent un nom composé plus long (Saint-Jean-de-Luz, Vernet-les-Bains). */
const COMPOUND_NEXT = new Set(["sur", "sous", "de", "du", "des", "d", "les", "le", "la", "l", "en"]);

/** Contexte qui confirme un homonyme : région, département. */
const CONTEXT_RE = /\b(occitanie|haute garonne|midi pyrenees|31)\b/;

/** Population au-delà de laquelle un homonyme est considéré comme la commune du 31 (Auterive : 10 000 hab.). */
const HOMONYM_TRUST_POPULATION = 5000;

export function normalizeLocation(s: string): string {
  return ` ${s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    // Séparateurs d'éléments : virgule, point-virgule, barre, parenthèses, tiret entouré d'espaces.
    .replace(/\s[-–—]\s/g, " , ")
    .replace(/[;|/()[\]]/g, " , ")
    .replace(/,/g, " , ")
    // Tirets et apostrophes à l'intérieur des noms : simples espaces.
    .replace(/[-'’‘`]/g, " ")
    .replace(/[^a-z0-9, ]/g, " ")
    .replace(/\bste\b/g, "sainte")
    .replace(/\bst\b/g, "saint")
    .replace(/\s+/g, " ")
    .trim()} `;
}

type CommuneKey = { key: string; population: number; homonym: boolean; exactOnly: boolean };

const COMMUNES: CommuneKey[] = HAUTE_GARONNE_COMMUNES.map(([name, population, homonym]) => {
  const key = normalizeLocation(name).trim();
  return { key, population, homonym: homonym === 1, exactOnly: EXACT_ONLY.has(key) };
});
const COMMUNE_KEYS = new Set(COMMUNES.map((c) => c.key));
/** Du nom le plus long au plus court : « Vieille-Toulouse » est reconnue avant « Toulouse ». */
const COMMUNES_LONGEST_FIRST = COMMUNES.slice().sort((a, b) => b.key.length - a.key.length);

/** Éléments du lieu (séparés par des virgules), sans les mots qui n'aident pas à situer. */
function segments(norm: string): string[] {
  return norm
    .split(",")
    .map((s) =>
      s
        .replace(/\bcedex\b( \d+)?/g, " ")
        .replace(/\b(france|fr|occitanie|haute garonne|midi pyrenees|area|region|metropolitan|greater|et peripherie)\b/g, " ")
        .replace(/\b\d{2,5}\b/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
}

/** Vrai si `key` apparaît dans `norm` comme nom complet (pas le début d'un nom composé plus long, hors 31). */
function containsCommune(norm: string, key: string): boolean {
  let from = 0;
  const needle = ` ${key} `;
  for (;;) {
    const at = norm.indexOf(needle, from);
    if (at < 0) return false;
    const after = norm.slice(at + needle.length).split(" ");
    const next = after[0];
    if (next && COMPOUND_NEXT.has(next)) {
      // « Saint-Jean-de-Luz » ≠ « Saint-Jean » ; mais un nom composé du 31 reste valable.
      const longer = `${key} ${after.slice(0, 3).join(" ")}`;
      if (Array.from(COMMUNE_KEYS).some((k) => k.startsWith(`${key} ${next}`) && longer.startsWith(k))) return true;
      from = at + 1;
      continue;
    }
    return true;
  }
}

type LocationSignals = {
  norm: string;
  /** Mention explicite de la Haute-Garonne : texte, code postal 31xxx ou département 31. */
  explicit31: boolean;
  /** Code postal ou département d'un AUTRE département. */
  otherCodes: boolean;
  /** Codes postaux trouvés. */
  postal: string[];
};

function signals(raw: string): LocationSignals {
  const norm = normalizeLocation(raw);
  const postal = Array.from(raw.matchAll(/(?<!\d)(\d{5})(?!\d)/g)).map((m) => m[1]);
  // Numéros de département : « (31) », « 31 - TOULOUSE » (France Travail), « Toulouse - 31 ».
  const depts = [
    ...Array.from(raw.matchAll(/\((\d{2}|2[AB]|97\d)\)/g)).map((m) => m[1]),
    ...Array.from(raw.matchAll(/(?:^|[\s,])(\d{2}|2[AB])\s*[-–]\s/g)).map((m) => m[1]),
    ...Array.from(raw.matchAll(/\s[-–]\s*(\d{2}|2[AB])\s*$/g)).map((m) => m[1]),
  ];
  const explicit31 =
    norm.includes(" haute garonne ") ||
    postal.some((p) => p.startsWith(ZONE_DEPARTEMENT)) ||
    depts.includes(ZONE_DEPARTEMENT);
  const otherCodes =
    postal.some((p) => !p.startsWith(ZONE_DEPARTEMENT)) || depts.some((d) => d !== ZONE_DEPARTEMENT);
  return { norm, explicit31, otherCodes, postal };
}

/**
 * Communes de Haute-Garonne nommées dans un lieu (clés normalisées : « toulouse »,
 * « saint orens de gameville »). Les codes postaux de Toulouse (31000 à 31500) comptent
 * pour « toulouse ».
 */
export function matchedCommunes(location: string | null | undefined): string[] {
  if (!location || !location.trim()) return [];
  const sig = signals(location);
  const { norm } = sig;
  const out = new Set<string>();
  if (sig.postal.some((p) => TOULOUSE_POSTAL_CODES.has(p))) out.add("toulouse");

  const segs = new Set(segments(norm));
  const hasContext = CONTEXT_RE.test(norm) || sig.explicit31;
  // Pour un nom ambigu, tous les éléments du lieu doivent être des communes du 31
  // (« Grenade, Espagne » ou « Saint-Jean (Savoie) » sont écartés).
  const onlyCommunes = Array.from(segs).every((s) => COMMUNE_KEYS.has(s));

  // Texte restant : un nom reconnu en est retiré, pour que « Vieille-Toulouse » ne compte
  // pas aussi comme « Toulouse ».
  let rest = norm;
  for (const c of COMMUNES_LONGEST_FIRST) {
    const exact = segs.has(c.key);
    if (c.homonym || c.exactOnly) {
      if (!exact || !onlyCommunes) continue;
      if (sig.otherCodes && !sig.explicit31) continue;
      if (c.homonym && !hasContext && c.population < HOMONYM_TRUST_POPULATION) continue;
      out.add(c.key);
      continue;
    }
    // Les noms très courts (« Ore », « Bax ») ne sont reconnus qu'en élément complet.
    if (c.key.length < 5 ? exact : containsCommune(rest, c.key)) {
      out.add(c.key);
      rest = rest.split(` ${c.key} `).join(" , ");
    }
  }
  return Array.from(out);
}

export function isInHauteGaronne(location: string | null | undefined): boolean {
  if (!location || !location.trim()) return false;
  if (signals(location).explicit31) return true;
  return matchedCommunes(location).length > 0;
}

// ----------- Secteurs de la zone (filtre « Lieu » de la liste des offres) -----------

/** Codes postaux de la ville de Toulouse. */
const TOULOUSE_POSTAL_CODES = new Set(["31000", "31100", "31200", "31300", "31400", "31500"]);

/** Les 37 communes de Toulouse Métropole (EPCI 243100518, @etalab/decoupage-administratif). */
const TOULOUSE_METROPOLE = new Set(
  [
    "Aigrefeuille", "Aucamville", "Aussonne", "Balma", "Beaupuy", "Beauzelle", "Blagnac", "Brax",
    "Bruguières", "Castelginest", "Colomiers", "Cornebarrieu", "Cugnaux", "Drémil-Lafage", "Fenouillet",
    "Flourens", "Fonbeauzard", "Gagnac-sur-Garonne", "Gratentour", "L'Union", "Launaguet", "Lespinasse",
    "Mondonville", "Mondouzil", "Mons", "Montrabé", "Pibrac", "Pin-Balma", "Quint-Fonsegrives",
    "Saint-Alban", "Saint-Jean", "Saint-Jory", "Saint-Orens-de-Gameville", "Seilh", "Toulouse",
    "Tournefeuille", "Villeneuve-Tolosane",
  ].map((n) => normalizeLocation(n).trim())
);


/** Vrai si l'offre est à Toulouse même, ou dans une commune de Toulouse Métropole. */
export function isInArea(location: string | null | undefined, area: ZoneArea): boolean {
  const communes = matchedCommunes(location);
  if (area === "toulouse") return communes.includes("toulouse");
  return communes.some((c) => TOULOUSE_METROPOLE.has(c));
}
