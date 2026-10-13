// Secteurs du filtre « Lieu » de la liste des offres. Module léger, importable côté
// client sans embarquer la liste des 586 communes.
export type ZoneArea = "toulouse" | "metropole";

export const ZONE_AREA_LABELS: Record<ZoneArea, string> = {
  toulouse: "Toulouse",
  metropole: "Toulouse Métropole",
};
