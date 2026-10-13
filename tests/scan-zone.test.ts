import { describe, expect, it, vi } from "vitest";
import type { ProgressEvent, ScrapeCriteria, ScrapedOffre, Scraper } from "@/lib/scrapers/base";
import { getDb } from "@/lib/db";
import { profile } from "./fixtures";

/**
 * runScan ne garde que les offres situées en Haute-Garonne, quelle que soit la source,
 * et transmet la zone aux scrapers. Faux scraper : aucun appel réseau.
 */

const seen = vi.hoisted(() => ({ criteria: null as ScrapeCriteria | null }));

vi.mock("@/lib/db/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/queries")>()),
  getProfile: () => ({ ...profile, sources_enabled: ["francetravail"] }),
}));

function offre(id: string, location: string | null): ScrapedOffre {
  return {
    source_id: id,
    url: `https://example.org/${id}`,
    title: `Poste ${id}`,
    company: "Entreprise",
    country: "France",
    location,
    contract_type: "CDI",
    salary: null,
    description_html: "<p>Description</p>",
    description_text: "Description du poste, missions et profil recherché.",
    description_status: "ok",
    posted_at: null,
    is_vie: false,
    raw_payload: {},
  };
}

vi.mock("@/lib/scrapers/registry", () => {
  const fake: Scraper = {
    name: "francetravail",
    async *scrape(criteria, onEvent: (e: ProgressEvent) => void) {
      seen.criteria = criteria;
      onEvent({ kind: "start", source: "francetravail" });
      yield offre("tls", "TOULOUSE");
      yield offre("blg", "Blagnac (31)");
      yield offre("par", "Paris");
      yield offre("vide", null);
      onEvent({ kind: "done", source: "francetravail", seen: 4, ok: 4, failed: 0 });
    },
  };
  return { VALID_SOURCES: ["francetravail"], getEnabledScrapers: () => [fake] };
});

describe("runScan — zone Haute-Garonne", () => {
  it("n'enregistre que les offres en Haute-Garonne et transmet la zone", async () => {
    const { runScan } = await import("@/lib/scan/orchestrator");
    const logs: string[] = [];
    for await (const _ of runScan((l) => logs.push(l))) void _;

    const ids = (getDb().prepare("SELECT source_id FROM offres ORDER BY source_id").all() as { source_id: string }[]).map(
      (r) => r.source_id
    );
    expect(ids).toEqual(["blg", "tls"]);
    expect(seen.criteria).toMatchObject({ zone: "Haute-Garonne", countries: ["France"] });
    expect(logs.at(-1)).toMatch(/2 hors Haute-Garonne ignorées/);
  });
});
