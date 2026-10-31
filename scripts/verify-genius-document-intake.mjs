import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROLE_CAPABILITIES } from "../lib/authority-catalog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");

const [
  packageJson,
  scanner,
  scannerPage,
  financeIntake,
  jobWorkspace,
  financeDocumentsRoute,
  analyzeRoute,
  downloadRoute,
  accessHelper,
  nextConfig,
  globalStyles,
] = await Promise.all([
  read("package.json"),
  read("components/genius-document-scanner.tsx"),
  read("app/documents/scan/page.tsx"),
  read("components/finance-document-intake.tsx"),
  read("components/operations-job-workspace.tsx"),
  read("app/api/finance/documents/route.ts"),
  read("app/api/finance/documents/[documentId]/analyze/route.ts"),
  read("app/api/documents/[documentId]/route.ts"),
  read("lib/job-document-access.server.ts"),
  read("next.config.ts"),
  read("app/globals.css"),
]);

const dependencies = JSON.parse(packageJson).dependencies;
assert.equal(dependencies["@thegrizzlylabs/web-geniusscan-sdk"], "6.6.0", "Genius Scan must be pinned to the reviewed SDK release");
assert(scanner.includes('await import("@thegrizzlylabs/web-geniusscan-sdk")'), "The heavy scanner SDK must load only after user activation");
assert(scanner.includes('source: "camera"') || scanner.includes("source,"), "The scanner must support camera capture");
assert(scanner.includes('void start("gallery")'), "The scanner must support graphical processing of a device image");
assert(scanner.indexOf('data-genius-action="camera"') > 0 && scanner.indexOf('["1", "Genius", "Cattura"]') > scanner.indexOf('data-genius-action="camera"'), "The primary scanner action must appear before explanatory workflow cards on mobile");
assert(scanner.includes('multiPageFormat: "pdf"') && scanner.includes("generatePDFFromImages"), "The scanner must produce a canonical PDF with a single-page fallback");
assert(scanner.includes('fetch("/api/finance/documents"'), "Genius output must enter the canonical Finance document intake");
assert(scanner.includes("idempotencyKey.current") && scanner.includes('readback?.status !== "verified"'), "Upload retry must remain idempotent and fail closed without readback");
assert(!scanner.includes("/analyze") && !scanner.includes("/api/finance/entries"), "Graphical scanning must not trigger AI analysis or economic writes automatically");
assert(scanner.includes("La licenza Genius non è valida per questo indirizzo") && scanner.includes("Accesso alla fotocamera non consentito"), "The scanner must explain provider and camera failures instead of collapsing them into a generic error");
assert(scanner.includes('document.documentElement.classList.add(scannerClass)') && scanner.includes('document.body.classList.add(scannerClass)'), "The scanner must suspend application chrome while the provider camera owns the viewport");
assert(scanner.includes("Bordi automatici · scatto manuale") && scanner.includes("la versione Web non esegue lo scatto automatico"), "The capture contract must distinguish automatic edge detection from the manual Web SDK shutter");
assert(globalStyles.includes("body.zw-genius-scanner-active :is(.zw-mobile-shell-header, .zw-mobile-nav--global)") && globalStyles.includes("display: none !important"), "The global shell must not cover the Genius top controls or manual shutter");

assert(scannerPage.includes("NEXT_PUBLIC_GENIUS_SCAN_LICENSE_KEY"), "The server page must provide the configured domain license to the client scanner");
assert(scannerPage.includes("canIntakeAssignedJobDocuments") && scannerPage.includes("target.assigned"), "The scanner page must verify assignment for scoped responsible users");
assert(financeIntake.includes("Scansiona documento con Genius"), "The canonical intake must expose the graphical scanner as its primary capture action");
assert(financeIntake.includes('data-navigation-mode="hard"') && financeIntake.includes('href={`/documents/scan?${scannerQuery.toString()}`}'), "The scanner entry must use a native hard navigation that remains reliable inside the installed PWA");
assert(financeIntake.includes('disabled={busy || loading || files.length === 0}'), "The canonical upload action must remain disabled until at least one file is selected");
assert(!financeIntake.includes('aria-label="File Finance"') && financeIntake.includes('aria-label="Scegli un documento già acquisito dal dispositivo"'), "The intake must use the accessible custom file picker instead of the native browser field presentation");
assert(financeIntake.includes('DIRECT_DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"') && !financeIntake.includes('capture="environment"'), "Direct intake must accept existing document files without offering a redundant raw-photo capture path");
assert(!financeIntake.includes("Foto rapida"), "The canonical intake must not duplicate raw camera capture next to the governed Genius scanner");
assert(financeIntake.includes('surface?: "finance" | "job"'), "The same document register must support Finance and job dossier surfaces");
assert(jobWorkspace.includes('<FinanceDocumentIntake initialJobId={jobId} surface="job" />'), "The commessa dossier must reuse the canonical Finance document register");
assert(jobWorkspace.includes("Date, turni, squadre e risorse si programmano nel modulo Pianificazione"), "The dossier must keep descriptive scope separate from scheduling");

assert(financeDocumentsRoute.includes("resolveJobDocumentTarget") && financeDocumentsRoute.includes("server-assignment-scope"), "Document list and upload must resolve job scope server-side");
assert(financeDocumentsRoute.includes("DUPLICATE_HASH_UPLOAD_CONTEXT") && financeDocumentsRoute.includes("existing_document_linked"), "A deduplicated original must still receive an audited link to the current job");
assert(analyzeRoute.includes("resolveJobDocumentTargets") && analyzeRoute.includes("allowedJobIds"), "Nutrient/OpenAI analysis must retain the assigned-job boundary");
assert(downloadRoute.includes("canReadAssignedJobDocuments") && downloadRoute.includes("assignedJobIds.size"), "Finance document download must enforce the same job assignment boundary");
assert(accessHelper.includes("rowMatchesContext") && accessHelper.includes("teamScopeTokens"), "Job document scope must use canonical person and team assignment matching");

assert(ROLE_CAPABILITIES.technical.includes("finance.documents.intake"), "Tecnico must be able to intake canonical job documents");
assert(ROLE_CAPABILITIES.field_supervisor.includes("finance.documents.job.intake"), "Caposquadra must be able to intake only assigned-job documents");
assert(!ROLE_CAPABILITIES.field_supervisor.includes("finance.read"), "Job document intake must not grant the Finance ledger to Caposquadra");
assert(!ROLE_CAPABILITIES.worker.includes("finance.documents.job.intake"), "Operatore must not gain dossier document intake implicitly");

const baseCsp = nextConfig.match(/baseContentSecurityPolicy = "([^"]+)"/)?.[1] ?? "";
const scannerCsp = nextConfig.match(/geniusScanContentSecurityPolicy = "([^"]+)"/)?.[1] ?? "";
assert(baseCsp && !baseCsp.includes("'unsafe-eval'"), "unsafe-eval must not be enabled application-wide");
assert(scannerCsp.includes("'unsafe-eval'") && scannerCsp.includes("connect-src 'self' data:"), "The dedicated scanner route must receive the documented Genius CSP");
const scannerHeaderRule = nextConfig.indexOf('{ source: "/documents/scan"');
const baseHeaderRule = nextConfig.indexOf('{ source: "/:path*"');
assert(scannerHeaderRule >= 0 && baseHeaderRule > scannerHeaderRule, "The scanner CSP must precede the ordinary catch-all so Vinext keeps the route-specific value");

console.log(JSON.stringify({
  status: "PASS",
  sdk: "@thegrizzlylabs/web-geniusscan-sdk@6.6.0",
  checks: [
    "lazy_graphical_scanner",
    "native_scanner_navigation",
    "camera_and_gallery",
    "mobile_primary_action_above_guidance",
    "scanner_shell_suppression",
    "manual_shutter_contract",
    "no_redundant_raw_photo",
    "pdf_generation_fallback",
    "canonical_finance_intake",
    "idempotent_server_readback",
    "no_automatic_ai_or_economic_write",
    "assigned_job_scope",
    "deduplicated_job_link_readback",
    "dossier_register_reuse",
    "planning_boundary_language",
    "role_least_privilege",
    "route_scoped_csp",
  ],
}));
