import { beforeEach, describe, expect, it } from "vitest";
import { findZoneFacets } from "@/lib/scrapers/careers/workday-parse";
import { detailToOffre } from "@/lib/scrapers/careers/workday";
import { capgeminiJobToOffre } from "@/lib/scrapers/careers/capgemini";
import { parseSafranDetail, parseSafranListing } from "@/lib/scrapers/careers/safran";
import { removeOffresOutsideZone } from "@/lib/scan/orchestrator";
import { getDb } from "@/lib/db";
import { upsertOffreFromSource, type ScrapedOffre } from "@/lib/db/offres";
import { getEnabledScrapers, VALID_SOURCES } from "@/lib/scrapers/registry";
import { CAREER_SOURCE_IDS, DEFAULT_SOURCE_IDS } from "@/lib/sources-meta";

/** Sites carrières (réponses fictives, aucun appel réseau) et filtre Haute-Garonne. */

const LONG = "Mission : concevoir et vérifier des équipements embarqués. ".repeat(5);

describe("sources sites carrières", () => {
  it("chaque site carrières a son scraper et est coché par défaut", () => {
    expect(CAREER_SOURCE_IDS).toEqual(["airbus", "safran", "thales", "capgemini", "accenture", "renault"]);
    for (const id of CAREER_SOURCE_IDS) {
      expect(VALID_SOURCES).toContain(id);
      expect(DEFAULT_SOURCE_IDS).toContain(id);
    }
    expect(getEnabledScrapers(CAREER_SOURCE_IDS).map((s) => s.name)).toEqual(CAREER_SOURCE_IDS);
  });
});

describe("Workday : filtre de lieu", () => {
  it("choisit le paramètre qui regroupe les communes du 31, y compris dans un groupe imbriqué", () => {
    const zone = findZoneFacets([
      { facetParameter: "jobFamilyGroup", values: [{ descriptor: "Engineering", id: "e1", count: 40 }] },
      {
        facetParameter: "locationMainGroup",
        values: [
          {
            facetParameter: "locationCountry",
            values: [{ descriptor: "France", id: "fr", count: 900 }],
          },
          {
            facetParameter: "locations",
            values: [
              { descriptor: "Toulouse", id: "t", count: 300 },
              { descriptor: "Blagnac", id: "b", count: 80 },
              { descriptor: "Hamburg", id: "h", count: 200 },
              { descriptor: "Marignane", id: "m", count: 50 },
            ],
          },
        ],
      },
    ]);
    expect(zone).toEqual({ parameter: "locations", ids: ["t", "b"], labels: ["Toulouse", "Blagnac"] });
  });

  it("renvoie null quand aucun lieu du 31 n'est proposé", () => {
    expect(findZoneFacets([{ facetParameter: "locations", values: [{ descriptor: "Paris", id: "p" }] }])).toBeNull();
    expect(findZoneFacets([])).toBeNull();
  });
});

describe("Workday : détail d'une offre", () => {
  const site = { id: "airbus", company: "Airbus", host: "ag.wd3.myworkdayjobs.com", tenant: "ag", site: "Airbus" };

  it("garde une offre dont un des lieux est en Haute-Garonne", () => {
    const o = detailToOffre(site, "/job/Toulouse/Ingenieur_JR1", {
      jobPostingInfo: {
        title: "Ingénieur stress",
        jobDescription: `<p>${LONG}</p>`,
        location: "Hamburg",
        additionalLocations: ["Toulouse"],
        startDate: "2026-10-08",
        jobReqId: "JR1",
      },
      hiringOrganization: { name: "Airbus Operations SAS" },
    });
    expect(o).toMatchObject({
      source_id: "JR1",
      company: "Airbus Operations SAS",
      location: "Toulouse",
      posted_at: "2026-10-08",
      description_status: "ok",
      url: "https://ag.wd3.myworkdayjobs.com/fr-FR/Airbus/job/Toulouse/Ingenieur_JR1",
    });
  });

  it("écarte une offre hors Haute-Garonne", () => {
    expect(
      detailToOffre(site, "/job/x", { jobPostingInfo: { title: "Poste", jobDescription: LONG, location: "Marignane" } })
    ).toBeNull();
  });
});

describe("Capgemini", () => {
  it("convertit une offre de l'API et filtre sur le lieu", () => {
    const job = {
      id: "572156-fr_FR_SAPBTP",
      title: "Ingénieure / Ingénieur vibro-acoustique",
      brand: "Capgemini Engineering",
      contract_type: "CDI",
      description: `<p>${LONG}</p>`,
      location: "Blagnac",
      apply_job_url: "https://careers.capgemini.com/job/1444696133/",
      indexed_at: "2026-10-06T11:12:17.000Z",
    };
    expect(capgeminiJobToOffre(job)).toMatchObject({
      source_id: "572156-fr_FR_SAPBTP",
      company: "Capgemini Engineering",
      contract_type: "CDI",
      location: "Blagnac",
      posted_at: "2026-10-06",
      description_status: "ok",
    });
    expect(capgeminiJobToOffre({ ...job, location: "Pau" })).toBeNull();
  });
});

describe("Safran", () => {
  it("extrait les liens d'offres d'une page de résultats", () => {
    const html = `
      <a href="/fr/offres/france/toulouse/ingenieur-systeme-fh-189144">Offre</a>
      <a href="https://www.safran-group.com/fr/offres/france/blagnac/technicien-fh-189282?x=1">Offre</a>
      <a href="/fr/offres?page=2">Suivant</a>
      <a href="/fr/offres/france/toulouse/ingenieur-systeme-fh-189144">Doublon</a>`;
    expect(parseSafranListing(html)).toEqual([
      "https://www.safran-group.com/fr/offres/france/toulouse/ingenieur-systeme-fh-189144",
      "https://www.safran-group.com/fr/offres/france/blagnac/technicien-fh-189282",
    ]);
  });

  const page = (where: string) => `<!doctype html><html><body>
    <h1>Ingénieur système F-H</h1>
    <p>Publié 09.10.2026</p>
    <ul><li>Société : Safran Electronics &amp; Defense</li><li>Emplacement : ${where}</li><li>Type de contrat : CDI</li></ul>
    <div class="content">
      <h2>Parlons de votre future mission</h2><p>${LONG}</p>
      <h2>Parlons de vous</h2><p>Diplômé d'une école d'ingénieur.</p>
    </div></body></html>`;

  it("lit le détail d'une offre en Haute-Garonne", () => {
    const url = "https://www.safran-group.com/fr/offres/france/toulouse/ingenieur-systeme-fh-189144";
    expect(parseSafranDetail(url, page("Toulouse, Occitanie, France"))).toMatchObject({
      source_id: "189144",
      title: "Ingénieur système F-H",
      company: "Safran Electronics & Defense",
      location: "Toulouse, Occitanie, France",
      contract_type: "CDI",
      posted_at: "2026-10-09",
      description_status: "ok",
    });
  });

  it("écarte une offre dont l'emplacement est ailleurs", () => {
    expect(parseSafranDetail("https://x/fr/offres/france/montereau/a-1", page("Montereau-sur-le-jard, Ile de France, France"))).toBeNull();
  });
});

describe("nettoyage des offres hors zone", () => {
  let seq = 0;
  const offre = (location: string): ScrapedOffre => ({
    source_id: `z-${++seq}`,
    url: `https://example.org/${seq}`,
    title: "Poste",
    company: "Entreprise",
    country: "France",
    location,
    contract_type: "CDI",
    salary: null,
    description_html: "<p>x</p>",
    description_text: "x",
    description_status: "ok",
    posted_at: null,
    is_vie: false,
    raw_payload: {},
  });

  beforeEach(() => {
    getDb().exec("DELETE FROM documents; DELETE FROM candidatures; DELETE FROM offres;");
  });

  it("retire les offres hors Haute-Garonne sans toucher à celles qui ont une candidature", () => {
    const toulouse = upsertOffreFromSource("francetravail", offre("TOULOUSE"));
    const paris = upsertOffreFromSource("francetravail", offre("Paris"));
    const lyonSuivie = upsertOffreFromSource("francetravail", offre("Lyon"));
    getDb().prepare("INSERT INTO candidatures (offre_id) VALUES (?)").run(lyonSuivie);

    expect(removeOffresOutsideZone()).toBe(1);
    const ids = (getDb().prepare("SELECT id FROM offres ORDER BY id").all() as { id: number }[]).map((r) => r.id);
    expect(ids).toEqual([toulouse, lyonSuivie]);
    expect(ids).not.toContain(paris);
  });
});
