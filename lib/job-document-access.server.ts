import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s04Records } from "@/db/schema";
import { hasCapability, type AuthorityContext } from "@/lib/authority-context";
import { rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";

type JobRow = typeof s04Records.$inferSelect;

function normalizedReference(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleUpperCase("it-IT");
}

function matchesReference(row: JobRow, references: Set<string>) {
  return references.has(normalizedReference(row.id))
    || references.has(normalizedReference(row.canonicalCode));
}

export function canReadAllFinanceDocuments(context: AuthorityContext) {
  return hasCapability(context, "finance.documents.read")
    || hasCapability(context, "finance.read");
}

export function canIntakeAllFinanceDocuments(context: AuthorityContext) {
  return hasCapability(context, "finance.documents.intake");
}

export function canReadAssignedJobDocuments(context: AuthorityContext) {
  return hasCapability(context, "finance.documents.job.read");
}

export function canIntakeAssignedJobDocuments(context: AuthorityContext) {
  return hasCapability(context, "finance.documents.job.intake");
}

/**
 * Resolves job references inside the active tenant and evaluates the current
 * actor against the server-owned assignment/team registry. A caller must not
 * treat a client-provided job id as authorization.
 */
export async function resolveJobDocumentTargets(
  context: AuthorityContext,
  rawReferences: readonly string[],
) {
  const references = new Set(rawReferences.map(normalizedReference).filter(Boolean));
  if (!references.size) return { jobs: [] as JobRow[], assignedJobIds: new Set<string>() };

  const db = getDb();
  const [jobs, workforceRows] = await Promise.all([
    db.select().from(s04Records).where(and(
      eq(s04Records.tenantId, context.tenantId),
      eq(s04Records.module, "operations"),
      eq(s04Records.recordType, "job"),
    )).limit(1_000),
    db.select().from(s04Records).where(and(
      eq(s04Records.tenantId, context.tenantId),
      eq(s04Records.module, "workforce"),
    )).limit(1_000),
  ]);
  const matchedJobs = jobs.filter((row) => matchesReference(row, references));
  const teamTokens = teamScopeTokens(workforceRows, context);
  const assignedJobIds = new Set(
    matchedJobs
      .filter((row) => rowMatchesContext(row, context, teamTokens))
      .map((row) => row.id),
  );
  return { jobs: matchedJobs, assignedJobIds };
}

export async function resolveJobDocumentTarget(
  context: AuthorityContext,
  reference: string,
) {
  const result = await resolveJobDocumentTargets(context, [reference]);
  const job = result.jobs[0] ?? null;
  return {
    job,
    assigned: Boolean(job && result.assignedJobIds.has(job.id)),
  };
}
