import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { offerDateKey, publishedSince, searchOffres, upsertOffreFromSource, type ScrapedOffre } from "@/lib/db/offres";
import { isInArea, matchedCommunes } from "@/lib/geo/haute-garonne";

/** Filtres « Publiées » (aujourd'hui, 7 jours, 14 jours) et « Lieu » (Toulouse, Toulouse Métropole). */

let seq = 0;
function offre(over: Partial<ScrapedOffre>): ScrapedOffre {
  seq++;
  return {
    source_id: `f-${seq}`,
    url: `https://example.org/${seq}`,
    title: `Poste ${seq}`,
    company: "Entreprise",
    country: "France",
    location: "Toulouse",
    contract_type: "CDI",
    salary: null,
    description_html: "<p>x</p>",
    description_text: "Description du poste.",
    description_status: "ok",
    posted_at: null,
    is_vie: false,
    raw_payload: {},
    ...over,
  };
}

function key(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return key(d);
}

beforeEach(() => {
  getDb().exec("DELETE FROM documents; DELETE FROM offres;");
});

describe("lieu : Toulouse et Toulouse Métropole", () => {
  it.each([
    ["Toulouse", true, true],
    ["31 - TOULOUSE", true, true],
    ["31400 Toulouse", true, true],
    ["Toulouse Cedex 9", true, true],
    ["Blagnac", false, true],
    ["Colomiers (31)", false, true],
    ["Saint-Orens-de-Gameville", false, true],
    ["31 - SAINT JEAN", false, true],
    ["Vieille-Toulouse", false, false],
    ["Muret", false, false],
    ["Saint-Gaudens", false, false],
  ])("« %s » : Toulouse %s, métropole %s", (loc, toulouse, metropole) => {
    expect(isInArea(loc, "toulouse")).toBe(toulouse);
    expect(isInArea(loc, "metropole")).toBe(metropole);
  });

  it("liste les communes nommées", () => {
    expect(matchedCommunes("Toulouse · Blagnac").sort()).toEqual(["blagnac", "toulouse"]);
  });

  it("filtre la liste et compte les offres par secteur", () => {
    upsertOffreFromSource("airbus", offre({ location: "Toulouse" }));
    upsertOffreFromSource("airbus", offre({ location: "Blagnac" }));
    upsertOffreFromSource("airbus", offre({ location: "Muret" }));
    expect(searchOffres().facets.areaCounts).toEqual({ toulouse: 1, metropole: 2 });
    expect(searchOffres({ area: "toulouse" }).total).toBe(1);
    expect(searchOffres({ area: "metropole" }).total).toBe(2);
    expect(searchOffres().total).toBe(3);
  });
});

describe("publiées : aujourd'hui, 7 jours, 14 jours", () => {
  it("date de publication, sinon date de découverte (UTC → heure locale)", () => {
    expect(offerDateKey("2026-10-08", "2026-10-13 08:00:00")).toBe("2026-10-08");
    expect(offerDateKey("2026-10-08T10:00:00Z", null)).toBe("2026-10-08");
    expect(offerDateKey(null, null)).toBeNull();
    const seen = new Date(2026, 9, 13, 12, 0, 0); // midi heure locale
    const utc = seen.toISOString().slice(0, 19).replace("T", " ");
    expect(offerDateKey(null, utc)).toBe("2026-10-13");
  });

  it("bornes : aujourd'hui = 1 jour, semaine = 7 jours, 2 semaines = 14 jours", () => {
    const now = new Date(2026, 9, 13, 10);
    expect(publishedSince("today", now)).toBe("2026-10-13");
    expect(publishedSince("week", now)).toBe("2026-10-07");
    expect(publishedSince("2weeks", now)).toBe("2026-09-30");
  });

  it("filtre la liste et compte les offres par période", () => {
    upsertOffreFromSource("francetravail", offre({ posted_at: daysAgo(0) }));
    upsertOffreFromSource("francetravail", offre({ posted_at: daysAgo(3) }));
    upsertOffreFromSource("francetravail", offre({ posted_at: daysAgo(10) }));
    upsertOffreFromSource("francetravail", offre({ posted_at: daysAgo(30) }));
    // Sans date de publication : compte comme découverte aujourd'hui.
    upsertOffreFromSource("francetravail", offre({ posted_at: null }));

    expect(searchOffres().facets.publishedCounts).toEqual({ today: 2, week: 3, "2weeks": 4 });
    expect(searchOffres({ published: "today" }).total).toBe(2);
    expect(searchOffres({ published: "week" }).total).toBe(3);
    expect(searchOffres({ published: "2weeks" }).total).toBe(4);
    expect(searchOffres({ published: "week", area: "toulouse" }).total).toBe(3);
  });

  it("un nouveau scan sans date ne change ni la date de publication ni la date de découverte", () => {
    const o = offre({ posted_at: daysAgo(5) });
    const id = upsertOffreFromSource("francetravail", o);
    getDb().prepare("UPDATE offres SET first_seen_at = '2026-01-01 08:00:00' WHERE id = ?").run(id);
    upsertOffreFromSource("francetravail", { ...o, posted_at: null });
    const row = getDb().prepare("SELECT posted_at, first_seen_at FROM offres WHERE id = ?").get(id) as {
      posted_at: string;
      first_seen_at: string;
    };
    expect(row).toEqual({ posted_at: daysAgo(5), first_seen_at: "2026-01-01 08:00:00" });
  });
});
