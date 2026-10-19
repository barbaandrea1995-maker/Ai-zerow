import assert from "node:assert/strict";
import {
  confirmCompanyAiMacroScopeProposal,
  deterministicCompanyAiMacroScopeProposal,
  getCompanyAiMacroScopeCatalog,
  normalizeCompanyAiMacroScopeProposal,
} from "../lib/company-ai-macro-scope.ts";

const catalog = getCompanyAiMacroScopeCatalog("tenant-test");
const cases = [
  {
    input: "Manutenzione palazzina",
    groups: ["EDILIZIA_IMMOBILI"],
    activities: [],
  },
  {
    input: "Allargamento marciapiede e sistemazione pozzetti",
    groups: ["STRADE_PAVIMENTAZIONI", "SCAVI_SOTTOSERVIZI"],
    activities: ["Allargamento marciapiede", "Sistemazione pozzetti"],
  },
  {
    input: "Perdita sotto il lavello",
    groups: ["IMPIANTI"],
    activities: [],
  },
  {
    input: "Taglio erba e potatura",
    groups: ["VERDE_ESTERNI"],
    activities: ["Taglio erba", "Potatura"],
  },
  {
    input: "Rifacimento tetto e riparazione impianto elettrico",
    groups: ["EDILIZIA_IMMOBILI", "IMPIANTI"],
    activities: ["Rifacimento tetto", "Riparazione impianto elettrico"],
  },
  {
    input: "Lavori speciali",
    groups: ["ALTRO_DA_CLASSIFICARE"],
    activities: [],
  },
];

for (const testCase of cases) {
  const proposal = deterministicCompanyAiMacroScopeProposal(testCase.input, catalog);
  assert.deepEqual(proposal.groupsProposed, testCase.groups, `groups: ${testCase.input}`);
  assert.deepEqual(proposal.activitiesProposed.map((activity) => activity.text), testCase.activities, `activities: ${testCase.input}`);
  assert.equal(proposal.descriptionOriginal, testCase.input, `verbatim source: ${testCase.input}`);
  assert.equal(proposal.scopeStatus, "DA_CONFERMARE", `proposal status: ${testCase.input}`);
}

const issue = deterministicCompanyAiMacroScopeProposal("Perdita sotto il lavello", catalog);
assert.equal(issue.reportedProblems.length, 1, "problem is kept separate from planned work");
assert.equal(issue.activitiesProposed.length, 0, "a reported leak does not invent a repair");

const mixed = deterministicCompanyAiMacroScopeProposal("Perdita sotto il lavello e riparazione del vetro", catalog);
assert.equal(mixed.reportedProblems.length, 1, "a problem stays separate when the description also includes work");
assert.deepEqual(mixed.activitiesProposed.map((activity) => activity.text), ["Riparazione del vetro"]);

const completed = deterministicCompanyAiMacroScopeProposal("Riparazione del vetro eseguita", catalog);
assert.equal(completed.completedWork.length, 1, "completed work is recorded separately");
assert.equal(completed.activitiesProposed.length, 0, "completed work is not proposed as future work");

const source = "Rifacimento tetto e riparazione impianto elettrico";
const normalized = normalizeCompanyAiMacroScopeProposal(source, {
  groups: [
    { id: "EDILIZIA_IMMOBILI", evidence: "tetto" },
    { id: "IMPIANTI", evidence: "impianto elettrico" },
    { id: "UNKNOWN_GROUP", evidence: "elettrico" },
  ],
  activities: [
    { text: "Rifacimento tetto", source: "Rifacimento tetto", groupIds: ["EDILIZIA_IMMOBILI"] },
    { text: "Sostituzione quadro elettrico", source: "sostituzione quadro elettrico", groupIds: ["IMPIANTI"] },
  ],
  reportedProblems: [],
  completedWork: [],
  clarifications: [],
}, catalog);
assert.deepEqual(normalized.groupsProposed, ["EDILIZIA_IMMOBILI", "IMPIANTI"]);
assert.deepEqual(normalized.activitiesProposed.map((activity) => activity.text), ["Rifacimento tetto"]);
assert.equal(normalized.descriptionOriginal, source, "model cannot replace the source description");

const confirmation = confirmCompanyAiMacroScopeProposal({
  proposal: deterministicCompanyAiMacroScopeProposal(cases[1].input, catalog),
  submitted: {
    confirmed: true,
    descriptionOriginal: cases[1].input,
    groupsConfirmed: ["STRADE_PAVIMENTAZIONI", "SCAVI_SOTTOSERVIZI"],
    activities: [
      { id: "macro-work-1", text: "Allargamento marciapiede", source: "Allargamento marciapiede", groupIds: ["STRADE_PAVIMENTAZIONI"], included: true },
      { id: "macro-work-2", text: "Sistemazione pozzetti", source: "sistemazione pozzetti", groupIds: ["SCAVI_SOTTOSERVIZI"], included: false },
    ],
  },
  catalog,
  actorId: "actor-test",
  confirmedAt: "2026-10-19T12:00:00.000Z",
});
assert.ok(confirmation, "human confirmation should produce a persisted scope");
assert.equal(confirmation.confirmation.status, "CONFERMATO");
assert.equal(confirmation.workItems.length, 1, "excluded suggestions do not enter the job work list");
assert.deepEqual(confirmation.confirmation.changes.activitiesExcluded, ["macro-work-2"]);
assert.equal(confirmation.confirmation.confirmedBy, "actor-test");

const tamperedDescription = confirmCompanyAiMacroScopeProposal({
  proposal: deterministicCompanyAiMacroScopeProposal(cases[1].input, catalog),
  submitted: { confirmed: true, descriptionOriginal: "testo alterato", groupsConfirmed: cases[1].groups, activities: [] },
  catalog,
  actorId: "actor-test",
  confirmedAt: "2026-10-19T12:00:00.000Z",
});
assert.equal(tamperedDescription, null, "changed source text must require a fresh preview");

console.log("COMPANY_AI_MACRO_SCOPE_V2_PASS");
