import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const roots = ["app", "components", "lib", "config"];
const topLevelFiles = ["next.config.ts"];
const extensions = new Set([".ts", ".tsx", ".json"]);
const findings = [];

const rules = [
  {
    id: "legacy-brand",
    pattern: /\bGEXY\b/i,
    message: "Il nome prodotto canonico è Company AI.",
  },
  {
    id: "legacy-map-provider",
    pattern: /\bMAPBOX\b/i,
    message: "Il provider cartografico canonico è Geoapify.",
  },
  {
    id: "direct-map-fallback",
    pattern: /tile\.openstreetmap\.org/i,
    message: "Le basi cartografiche devono arrivare dalla configurazione Geoapify del server.",
  },
  {
    id: "remote-font-runtime",
    pattern: /fonts\.(?:googleapis|gstatic)\.com/i,
    message: "I font dell’interfaccia non devono dipendere da una richiesta remota.",
  },
  {
    id: "wrong-warehouse-role",
    pattern: /responsabile\s+magazziniere/i,
    message: "La mansione canonica è Responsabile magazzino.",
  },
  {
    id: "ambiguous-asset-name",
    pattern: /\basset\s+(?:1\s*[\/,]\s*2\s*[\/,]\s*3|[123])\b/i,
    message: "Gli asset devono essere mostrati con nome, modello, targa o codice canonico.",
  },
  {
    id: "english-owner-label",
    pattern: /(?:owner|label)\s*:\s*["']Owner["']/,
    message: "Il ruolo visualizzato in italiano è Titolare; la chiave interna resta owner.",
  },
  {
    id: "visible-owner-role",
    pattern: /(?:contesto\s+owner|owner\s*·|>\s*Owner\s*<|Owner verificato|L[’']Owner|all[’']owner|membership owner|owner approval gate|owner con tenant\.manage)/i,
    message: "La chiave RBAC owner non deve comparire nella copia: mostrare Titolare.",
  },
  {
    id: "legacy-surface-label",
    pattern: /\bsuperficie\b/i,
    message: "La voce canonica dell’interfaccia è sezione.",
  },
  {
    id: "noncanonical-navigation-label",
    pattern: /label\s*:\s*["'](?:COMMAND|OPERATIONS|WORKFORCE|PLANNING|FINANCE|PROCUREMENT|MISSION|AUTHORITY|EXTERNALS|EVENTS\s*\/\s*LEDGER)["']/,
    message: "La navigazione deve usare i nomi canonici italiani della sidebar.",
  },
  {
    id: "missing-italian-accent",
    pattern: /\b(?:identita|attivita|quantita|unita|visibilita|possibilita|disponibilita|proprieta|operativita|priorita|modalita|responsabilita|validita|citta|qualita|velocita|necessita|criticita|affidabilita|integrita|conformita|capacita|specialita|perche|cosi|piu|gia|puo|cioe|pero|sara|verra|dovra|potra|andra|giu)\b/i,
    message: "Correggere l’accento nella copia italiana.",
  },
  {
    id: "missing-verb-accent",
    pattern: /\bnon e\b|\be stat[oa]\s+(?:caricat|inviat|pers|ricevut|registrat|collegat|configurat|disponibil)/i,
    message: "Usare è nella forma verbale.",
  },
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (extensions.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}

function isIntentionalInputAlias(file, line, ruleId) {
  if (ruleId !== "missing-italian-accent") return false;
  if (file === "app/api/operations/intake/route.ts") return true;
  return line.includes("#attivita");
}

for (const root of roots) {
  for (const file of await walk(root)) {
    const source = await readFile(file, "utf8");
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      for (const rule of rules) {
        if (isIntentionalInputAlias(file, line, rule.id)) continue;
        if (!rule.pattern.test(line)) continue;
        findings.push({
          rule: rule.id,
          file,
          line: index + 1,
          message: rule.message,
          excerpt: line.trim().slice(0, 220),
        });
      }
    }
  }
}

for (const file of topLevelFiles) {
  const source = await readFile(file, "utf8");
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    for (const rule of rules) {
      if (!rule.pattern.test(line)) continue;
      findings.push({
        rule: rule.id,
        file,
        line: index + 1,
        message: rule.message,
        excerpt: line.trim().slice(0, 220),
      });
    }
  }
}

const authorityCatalog = await readFile("lib/authority-catalog.ts", "utf8");
const canonicalRoles = {
  owner: "Titolare",
  admin: "Amministratore",
  member: "Collaboratore",
  manager: "Manager",
  office: "Ufficio",
  technical: "Tecnico",
  field_supervisor: "Caposquadra",
  worker: "Operatore",
  warehouse_manager: "Responsabile magazzino",
  warehouse_operator: "Magazziniere",
  driver: "Autista",
  delivery_driver: "Autista di consegna",
  maintenance: "Manutentore",
  auditor: "Auditor",
};
for (const [role, label] of Object.entries(canonicalRoles)) {
  const required = `${role}: { label: "${label}"`;
  if (!authorityCatalog.includes(required)) {
    findings.push({ rule: "canonical-role-missing", file: "lib/authority-catalog.ts", line: 0, message: `Definizione mancante: ${required}`, excerpt: "" });
  }
}

if (findings.length) {
  console.error(JSON.stringify({ status: "FAIL", findings }, null, 2));
}

assert.equal(findings.length, 0, `Audit terminologico fallito: ${findings.length} occorrenze`);

console.log(JSON.stringify({
  status: "PASS",
  roots,
  topLevelFiles,
  rules: rules.length + 3,
  canonicalRoles: Object.values(canonicalRoles),
  acceptedProductTerms: [
    "Company AI", "Command", "commessa", "attività", "rapportino", "missione", "magazzino",
    "asset", "mezzo di trasporto", "utilizzatore operativo", "assegnazione a lungo termine",
    "tracking", "geofence", "Geoapify", "PWA", "D1",
  ],
}, null, 2));
