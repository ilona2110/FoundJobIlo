import { detectVie } from "./vie";

export type ContractCategory = "graduate" | "cdi" | "cdd" | "vie" | "stage" | "alternance" | "autre";

export const CONTRACT_LABELS: Record<ContractCategory, string> = {
  graduate: "Graduate programme",
  cdi: "CDI",
  cdd: "CDD",
  vie: "V.I.E",
  stage: "Stage",
  alternance: "Alternance",
  autre: "Autre",
};

export const CONTRACT_ORDER: ContractCategory[] = ["graduate", "cdi", "cdd", "vie", "stage", "alternance", "autre"];

function strip(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Graduate programme : poste de jeune diplômé avec parcours structuré (rotations,
// formation, mentorat), souvent en CDI. Reconnu par son intitulé, ou par une mention
// explicite au début de la description (« dans le cadre de notre Graduate Programme »).
const GRADUATE_TITLE_RE =
  /\b(graduate|graduates)\s*(programme|program|scheme|trainee|training|development|rotation|rotational|track)|\b(programme|program|parcours)\s+(jeunes?\s+diplomes?|graduates?)\b|\b(young\s+graduates?|jeunes?\s+diplomes?)\s+(programme|program)\b|\b(rotational|leadership\s+development|trainee)\s+(programme|program)\b|\bgraduate\b/;
const GRADUATE_DESC_RE =
  /\bgraduate\s*(programme|program|scheme)\b|\b(programme|program)\s+(jeunes?\s+diplomes?|graduates?)\b|\b(rotational|leadership\s+development)\s+(programme|program)\b/;

export function isGraduateProgramme(input: { title: string; description_text?: string | null; contract_type?: string | null }): boolean {
  const title = `${strip(input.title)} ${strip(input.contract_type)}`;
  // « Graduate » seul dans un intitulé (« Graduate Engineer ») compte ; « undergraduate » non.
  if (GRADUATE_TITLE_RE.test(title.replace(/\bundergraduate\b/g, " ").replace(/\bpost[\s-]?graduate\b/g, " "))) return true;
  return GRADUATE_DESC_RE.test(strip(input.description_text).slice(0, 1500));
}

export function classifyContract(input: {
  contract_type: string | null;
  title: string;
  description_text: string;
  is_vie?: number | boolean; // legacy, ignored — we re-detect on the fly
  source?: string | null;
  url?: string | null;
}): ContractCategory {
  // 1. V.I.E with strict detection (re-evaluated, ignores any stale is_vie flag).
  //    We check this BEFORE alternance/stage so "V.I.E Marketing" is V.I.E, not "stage".
  if (
    detectVie({
      source: input.source ?? "",
      title: input.title,
      description: input.description_text,
      url: input.url,
    })
  ) {
    return "vie";
  }

  // 1 bis. Graduate programme (avant stage/alternance : « Graduate Programme » n'est pas un stage).
  if (isGraduateProgramme(input)) return "graduate";

  const haystack = `${strip(input.contract_type)} ${strip(input.title)} ${strip(input.description_text).slice(0, 1500)}`;

  // 2. Alternance / apprentissage (very specific keywords)
  if (/\b(alternance|alternant|apprentissage|apprenti|contrat\s+pro|professionnalisation)\b/.test(haystack)) {
    return "alternance";
  }
  // 3. Stage / internship
  if (/\b(stage|stagiaire|internship|intern)\b/.test(haystack)) {
    return "stage";
  }
  // 4. CDD
  if (/\bcdd\b|\bfixed[\s-]term\b|\btemporary\b|\btemporaire\b|\bcontrat\s+a\s+duree\s+determinee\b/.test(haystack)) {
    return "cdd";
  }
  // 5. CDI
  if (/\bcdi\b|\bpermanent\b|\bcontrat\s+a\s+duree\s+indeterminee\b/.test(haystack)) {
    return "cdi";
  }

  // 6. JSON-LD employmentType fallback
  const ct = strip(input.contract_type);
  if (ct.includes("intern")) return "stage";
  if (ct.includes("temporary") || ct.includes("contractor")) return "cdd";
  if (ct.includes("full_time") || ct.includes("part_time") || ct.includes("full time") || ct.includes("part time")) {
    return "cdi";
  }

  return "autre";
}
