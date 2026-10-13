import "server-only";
import type { Scraper } from "../base";
import { createWorkdayScraper, type WorkdaySite } from "./workday";
import { capgeminiScraper } from "./capgemini";
import { safranScraper } from "./safran";

// Sites carrières interrogés directement. Pour ajouter une entreprise sur Workday,
// ouvrez son site carrières : l'adresse a la forme https://{hôte}/fr-FR/{site}
// (ex. https://ag.wd3.myworkdayjobs.com/fr-FR/Airbus) ; le tenant est en général
// le premier mot de l'hôte. Ajoutez aussi l'entrée dans lib/sources-meta.ts.
export const WORKDAY_SITES: WorkdaySite[] = [
  // Airbus (Operations, Defence and Space, Helicopters…) ; ATR publie aussi ses offres ici.
  { id: "airbus", company: "Airbus", host: "ag.wd3.myworkdayjobs.com", tenant: "ag", site: "Airbus" },
  { id: "thales", company: "Thales", host: "thales.wd3.myworkdayjobs.com", tenant: "thales", site: "Careers" },
  {
    id: "renault",
    company: "Renault Group",
    host: "alliancewd.wd3.myworkdayjobs.com",
    tenant: "alliancewd",
    site: "renault-group-careers",
  },
  {
    id: "accenture",
    company: "Accenture",
    host: "accenture.wd103.myworkdayjobs.com",
    tenant: "accenture",
    site: "AccentureCareers",
  },
];

export const careerScrapers: Record<string, Scraper> = {
  ...Object.fromEntries(WORKDAY_SITES.map((s) => [s.id, createWorkdayScraper(s)])),
  safran: safranScraper,
  capgemini: capgeminiScraper,
};
