import OperationsJobWorkspace from "@/components/operations-job-workspace";
import { hasCapability } from "@/lib/authority-context";
import { requirePageCapability } from "@/lib/page-access";

type PageProps = { params: Promise<{ jobId: string }> };

export default async function OperationsJobPage({ params }: PageProps) {
  const { jobId } = await params;
  const authority = await requirePageCapability("operations.read");
  return (
    <OperationsJobWorkspace
      canWriteOperations={hasCapability(authority, "operations.write")}
      canWriteReport={hasCapability(authority, "operations.rapportino.write") || hasCapability(authority, "operations.write") || (hasCapability(authority, "field.write") && hasCapability(authority, "workforce.registry.read"))}
      canReviewReport={hasCapability(authority, "operations.rapportino.review")}
      jobId={decodeURIComponent(jobId)}
    />
  );
}
