import { describe, expect, it } from "vitest";
import { classifyContract, isGraduateProgramme } from "@/lib/contracts";
import { isVagueLocation, keepInZone } from "@/lib/geo/zone-policy";
import { scoreOffreLocal } from "@/lib/scoring/local";
import { detailToOffre } from "@/lib/scrapers/careers/workday";
import { profile } from "./fixtures";

/** Graduate programmes : reconnus, filtrables, mis en avant, et gardés malgré un lieu générique. */

const LONG = "Vous rejoindrez nos équipes d'ingénierie pour des missions variées et formatrices. ".repeat(4);

describe("isGraduateProgramme", () => {
  it.each([
    "Airbus Graduate Programme - Engineering",
    "Graduate Program Finance (F/H)",
    "Programme Jeunes Diplômés - Supply Chain",
    "Young Graduates Programme 2027",
    "Leadership Development Program",
    "Graduate Engineer - Avionics",
    "VIE Graduate Trainee",
  ])("reconnaît « %s »", (title) => {
    expect(isGraduateProgramme({ title })).toBe(true);
  });

  it.each(["Ingénieur système F-H", "Undergraduate internship", "Postgraduate researcher", "Stage - Talent Acquisition"])(
    "ne reconnaît pas « %s »",
    (title) => {
      expect(isGraduateProgramme({ title })).toBe(false);
    }
  );

  it("reconnaît une mention explicite au début de la description", () => {
    expect(
      isGraduateProgramme({ title: "Ingénieur(e) méthodes", description_text: "Ce poste s'inscrit dans notre Graduate Programme de 24 mois." })
    ).toBe(true);
  });

  it("classe en « graduate », avant stage et CDI", () => {
    expect(classifyContract({ contract_type: "CDI", title: "Graduate Programme Engineering", description_text: "" })).toBe("graduate");
    expect(classifyContract({ contract_type: "CDI", title: "Ingénieur système", description_text: "" })).toBe("cdi");
  });
});

describe("zone et graduate programmes", () => {
  it("lieu générique : « France », « 3 Locations », vide", () => {
    for (const l of ["France", "3 Locations", "Plusieurs lieux", "", null]) expect(isVagueLocation(l)).toBe(true);
    for (const l of ["Paris", "Hamburg, Germany", "Toulouse"]) expect(isVagueLocation(l)).toBe(false);
  });

  it("garde un graduate programme au lieu générique, pas une offre classique", () => {
    expect(keepInZone({ location: "France", title: "Graduate Programme Finance" })).toBe(true);
    expect(keepInZone({ location: "France", title: "Contrôleur de gestion" })).toBe(false);
  });

  it("écarte un graduate programme situé ailleurs", () => {
    expect(keepInZone({ location: "Paris", title: "Graduate Programme Finance" })).toBe(false);
  });

  it("Workday : garde un graduate programme localisé « France »", () => {
    const site = { id: "airbus", company: "Airbus", host: "ag.wd3.myworkdayjobs.com", tenant: "ag", site: "Airbus" };
    const o = detailToOffre(site, "/job/France/Graduate_JR9", {
      jobPostingInfo: { title: "Airbus Graduate Programme", jobDescription: `<p>${LONG}</p>`, location: "France", jobReqId: "JR9" },
    });
    expect(o).toMatchObject({ source_id: "JR9", location: "France" });
  });
});

describe("score", () => {
  const offre = (title: string) => ({
    title,
    company: "Airbus",
    country: "France",
    description_text: `${LONG} Contrat : CDI.`,
    contract_type: "CDI",
  });

  it("un graduate programme recherché passe devant un CDI équivalent", () => {
    const p = { ...profile, preferred_contracts: ["graduate", "cdi"] } as any;
    const grad = scoreOffreLocal(p, offre("Graduate Programme Ingénierie"));
    const cdi = scoreOffreLocal(p, offre("Ingénieur Ingénierie"));
    expect(grad.score).toBeGreaterThan(cdi.score);
    expect(grad.reason).toContain("Graduate programme recherché");
  });
});
