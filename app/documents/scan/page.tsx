import { redirect } from "next/navigation";
import GeniusDocumentScanner from "@/components/genius-document-scanner";
import { hasCapability } from "@/lib/authority-context";
import { FINANCE_DOCUMENT_CATEGORIES } from "@/lib/finance-document-contract";
import {
  canIntakeAllFinanceDocuments,
  canIntakeAssignedJobDocuments,
  resolveJobDocumentTarget,
} from "@/lib/job-document-access.server";
import { requirePageContext } from "@/lib/page-access";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function queryValue(value: string | string[] | undefined, max: number) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return (candidate ?? "").trim().slice(0, max);
}

export const dynamic = "force-dynamic";

export default async function DocumentScanPage({ searchParams }: { searchParams: SearchParams }) {
  const authority = await requirePageContext();
  if (!hasCapability(authority, "documents.read")) redirect("/access-denied?required=documents.read");
  const canIntakeAll = canIntakeAllFinanceDocuments(authority);
  const canIntakeAssigned = canIntakeAssignedJobDocuments(authority);
  if (!canIntakeAll && !canIntakeAssigned) {
    redirect("/access-denied?required=finance.documents.intake");
  }

  const query = await searchParams;
  const requestedJobId = queryValue(query.jobId, 160);
  const origin = queryValue(query.origin, 16) === "job" ? "job" : "finance";
  const requestedCategory = queryValue(query.category, 80).toUpperCase();
  const initialCategory = FINANCE_DOCUMENT_CATEGORIES.some((item) => item.value === requestedCategory)
    ? requestedCategory
    : FINANCE_DOCUMENT_CATEGORIES[0].value;

  const target = requestedJobId ? await resolveJobDocumentTarget(authority, requestedJobId) : null;
  if (requestedJobId && !target?.job) redirect(origin === "job" ? "/operations" : "/finance?tab=documents");
  if (!canIntakeAll && (!target?.job || !target.assigned)) {
    redirect("/access-denied?required=finance.documents.job.intake");
  }
  const jobId = target?.job?.id ?? "";
  const returnHref = origin === "job" && jobId
    ? `/operations/${encodeURIComponent(jobId)}?tab=operations`
    : jobId
      ? `/finance?jobId=${encodeURIComponent(jobId)}&tab=documents`
      : "/finance?tab=documents";

  return <GeniusDocumentScanner
    initialCategory={initialCategory}
    jobId={jobId}
    licenseKey={(process.env.NEXT_PUBLIC_GENIUS_SCAN_LICENSE_KEY ?? "").trim()}
    returnHref={returnHref}
  />;
}
