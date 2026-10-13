import { describe, expect, it } from "vitest";
import { isInHauteGaronne, ZONE_SEARCH_CITIES } from "@/lib/geo/haute-garonne";

/** Filtre géographique : seules les offres situées en Haute-Garonne (31) sont gardées. */
describe("isInHauteGaronne", () => {
  it.each([
    "Toulouse",
    "TOULOUSE",
    "Toulouse, Occitanie, France",
    "France - Toulouse",
    "Toulouse Cedex 9",
    "Toulouse et périphérie",
    "Blagnac",
    "31 - BLAGNAC",
    "31 - Haute-Garonne",
    "Colomiers (31)",
    "31700 Blagnac",
    "Labège",
    "Labege, France",
    "Saint-Orens-de-Gameville",
    "St Orens de Gameville",
    "Ramonville-Saint-Agne",
    "Cornebarrieu, Occitanie",
    "Merignac, SCHILTIGHEIM, Lyon, Toulouse, Issy-les-Moulineaux",
    "Vieille-Toulouse",
    "Haute-Garonne",
    "Auterive",
    "Grenade, Occitanie, France",
    "L'Union",
  ])("garde « %s »", (loc) => {
    expect(isInHauteGaronne(loc)).toBe(true);
  });

  it.each([
    null,
    "",
    "Paris",
    "Paris (75)",
    "Lyon, Auvergne-Rhône-Alpes, France",
    "Bordeaux",
    "33700 Mérignac",
    "France",
    "Occitanie",
    "Montpellier, Occitanie, France",
    "Tarbes (65)",
    "Saint-Jean-de-Luz",
    "Vernet-les-Bains",
    "Aigrefeuille-sur-Maine",
    "Grenade, Espagne",
    "Granada, Spain",
    "Saint-Jean (Savoie)",
    "Hamburg, Germany",
    "Remote",
  ])("écarte « %s »", (loc) => {
    expect(isInHauteGaronne(loc)).toBe(false);
  });

  it("propose Toulouse en premier mot-clé de recherche", () => {
    expect(ZONE_SEARCH_CITIES[0]).toBe("Toulouse");
    expect(ZONE_SEARCH_CITIES).toContain("Colomiers");
  });
});
