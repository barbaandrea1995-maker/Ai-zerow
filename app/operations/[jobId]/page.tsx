import OperationsJobWorkspace from "@/components/operations-job-workspace";

type PageProps = { params: Promise<{ jobId: string }> };

export default async function OperationsJobPage({ params }: PageProps) {
  const { jobId } = await params;
  return <OperationsJobWorkspace jobId={decodeURIComponent(jobId)} />;
}
