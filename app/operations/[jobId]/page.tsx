import OperationsJobWorkspace from "@/components/operations-job-workspace";
import { hasCapability } from "@/lib/authority-context";
import { canWriteOperationsRapportino } from "@/lib/operations-permissions";
import { requirePageCapability } from "@/lib/page-access";

type PageProps = { params: Promise<{ jobId: string }> };

export default async function OperationsJobPage({ params }: PageProps) {
  const { jobId } = await params;
  // The dossier is a full commesse surface. Field-only accounts keep their
  // narrowly scoped API context, but cannot open the full job workspace.
  const authority = await requirePageCapability("operations.index.read");
  return (
    <OperationsJobWorkspace
      canWriteOperations={hasCapability(authority, "operations.write")}
      canWriteReport={canWriteOperationsRapportino(authority.capabilities)}
      canReviewReport={hasCapability(authority, "operations.rapportino.review")}
      canReadFinance={hasCapability(authority, "finance.read")}
      canReadJobDocuments={hasCapability(authority, "finance.documents.read") || hasCapability(authority, "finance.documents.job.read")}
      canReadWarehouse={hasCapability(authority, "warehouse.read")}
      jobId={decodeURIComponent(jobId)}
    />
  );
}
