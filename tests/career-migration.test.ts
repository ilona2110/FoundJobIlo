import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { dbPath } from "@/lib/paths";

/** Une base existante (profil avec France Travail seule) reçoit les sites carrières et les graduate programmes une seule fois. */
describe("migration des sites carrières", () => {
  it("coche les sites carrières d'un profil existant, une seule fois", async () => {
    const file = dbPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const pre = new DatabaseSync(file);
    pre.exec(fs.readFileSync(path.join(process.cwd(), "lib", "db", "schema.sql"), "utf-8"));
    pre.prepare("INSERT INTO profile (full_name, sources_enabled) VALUES ('Test', ?)").run(JSON.stringify(["francetravail"]));
    pre.close();

    const { getDb } = await import("@/lib/db");
    const db = getDb();
    const row = db.prepare("SELECT sources_enabled FROM profile").get() as { sources_enabled: string };
    expect(JSON.parse(row.sources_enabled)).toEqual([
      "francetravail",
      "airbus",
      "safran",
      "thales",
      "capgemini",
      "accenture",
      "renault",
    ]);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'migration.career_sources'").get()).toEqual({ value: "1" });
    // Graduate programmes ajoutés en tête des contrats recherchés.
    const prefs = db.prepare("SELECT preferred_contracts FROM profile").get() as { preferred_contracts: string };
    expect(JSON.parse(prefs.preferred_contracts)).toEqual(["graduate", "cdi", "cdd"]);
  });
});
