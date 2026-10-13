// Règle de zone appliquée à chaque offre : Haute-Garonne, avec une seule exception —
// un graduate programme dont le lieu n'est pas précisé (« France », « Plusieurs lieux »)
// est gardé, car ces programmes affichent souvent un lieu générique alors qu'ils se
// déroulent en partie à Toulouse. Une offre située ailleurs (Paris, Hambourg) reste écartée.
import { isGraduateProgramme } from "@/lib/contracts";
import { isInHauteGaronne, normalizeLocation } from "./haute-garonne";

const VAGUE_WORDS =
  /\b(france|fr|occitanie|multiple|multiples|various|several|locations?|plusieurs|divers|lieux|sites?|emplacements?|villes?|et|and|\d+)\b/g;

/** Lieu absent ou générique : « France », « 3 Locations », « Plusieurs lieux ». */
export function isVagueLocation(location: string | null | undefined): boolean {
  if (!location || !location.trim()) return true;
  return normalizeLocation(location).replace(/,/g, " ").replace(VAGUE_WORDS, " ").trim() === "";
}

export type ZoneCandidate = {
  location: string | null;
  title: string;
  description_text?: string | null;
  contract_type?: string | null;
};

export function keepInZone(o: ZoneCandidate): boolean {
  if (isInHauteGaronne(o.location)) return true;
  return isVagueLocation(o.location) && isGraduateProgramme(o);
}
