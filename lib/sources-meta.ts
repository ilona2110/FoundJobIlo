// Métadonnées des sources — importable côté client ET serveur (pas de "server-only").
// La liste des scrapers effectifs vit dans lib/scrapers/registry.ts (server-only) ;
// les deux doivent rester synchronisées via SOURCE_IDS.

export type SourceMeta = {
  id: string;
  label: string;
  sublabel: string;
  // Périmètre géographique : "world" = international, "fr" = France uniquement
  scope: "world" | "fr";
  /**
   * La source a besoin du moteur de navigation Chromium (~100 Mo à télécharger,
   * ~265 Mo sur le disque), téléchargé
   * à la demande et non embarqué dans l'installeur. Décochée par défaut.
   */
  requiresEngine?: boolean;
  /**
   * Source hors service ou suspendue : décochée par défaut, absente du menu « Scanner une
   * source », et jamais interrogée, même si un ancien profil l'a gardée cochée (orchestrateur).
   */
  unavailable?: boolean;
  /**
   * Les conditions du site interdisent l'extraction automatisée : la source reste décochée
   * par défaut et ne s'active que par un choix explicite de l'utilisateur (CGU.md, § 5 et 6).
   */
  optIn?: boolean;
  /** Site carrières d'une entreprise (lib/scrapers/careers), filtré sur la Haute-Garonne. */
  career?: boolean;
};

/** Sites carrières d'entreprises, interrogés directement (offres en Haute-Garonne uniquement). */
const CAREER_SITE = "Site carrières · Haute-Garonne";

export const SOURCES_META: SourceMeta[] = [
  { id: "airbus", label: "Airbus", sublabel: `${CAREER_SITE} · avec ATR`, scope: "fr", career: true },
  { id: "safran", label: "Safran", sublabel: CAREER_SITE, scope: "fr", career: true },
  { id: "thales", label: "Thales", sublabel: CAREER_SITE, scope: "fr", career: true },
  { id: "capgemini", label: "Capgemini", sublabel: CAREER_SITE, scope: "fr", career: true },
  { id: "accenture", label: "Accenture", sublabel: CAREER_SITE, scope: "fr", career: true },
  { id: "renault", label: "Renault Group", sublabel: CAREER_SITE, scope: "fr", career: true },
  { id: "wttj", label: "Welcome to the Jungle", sublabel: "Startups & scale-ups · à activer vous-même", scope: "world", optIn: true },
  {
    id: "linkedin",
    label: "LinkedIn",
    sublabel: "Nécessite le moteur Chromium (~100 Mo)",
    scope: "world",
    requiresEngine: true,
  },
  {
    id: "civiweb",
    label: "Civiweb — V.I.E",
    sublabel: "Suspendue : Business France exige désormais une authentification",
    scope: "world",
    unavailable: true,
  },
  {
    id: "apec",
    label: "APEC",
    sublabel: "Suspendue : le site bloque désormais les requêtes automatiques",
    scope: "fr",
    unavailable: true,
  },
  { id: "hellowork", label: "HelloWork", sublabel: "Ex-RegionsJob (France) · à activer vous-même", scope: "fr", optIn: true },
  { id: "francetravail", label: "France Travail", sublabel: "Ex-Pôle Emploi (France)", scope: "fr" },
  { id: "talent", label: "Talent.com", sublabel: "Francophonie · Canada · USA · à activer vous-même", scope: "world", optIn: true },
];

export const SOURCE_IDS = SOURCES_META.map((s) => s.id);

/** Sites carrières d'entreprises (Airbus, Safran…). */
export const CAREER_SOURCE_IDS = SOURCES_META.filter((s) => s.career).map((s) => s.id);

/**
 * Sources cochées par défaut : toutes sauf celles qui exigent un téléchargement
 * supplémentaire, celles qui sont hors service et celles dont les conditions
 * interdisent l'extraction automatisée (opt-in) : France Travail et les sites carrières.
 */
export const DEFAULT_SOURCE_IDS = SOURCES_META.filter((s) => !s.requiresEngine && !s.unavailable && !s.optIn).map(
  (s) => s.id
);

export function sourceUnavailable(id: string): boolean {
  return SOURCES_META.some((s) => s.id === id && s.unavailable === true);
}

export function sourceRequiresEngine(id: string): boolean {
  return SOURCES_META.some((s) => s.id === id && s.requiresEngine === true);
}

export function sourceLabel(id: string): string {
  return SOURCES_META.find((s) => s.id === id)?.label ?? id;
}
