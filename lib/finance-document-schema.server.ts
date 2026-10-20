/**
 * Compatibility hook retained for existing callers. Finance schema is now
 * migration-owned: request handling must never create or alter D1 tables.
 * A missing migration therefore fails closed on the caller's first query.
 */
export async function ensureFinanceDocumentSchema() {
  return Promise.resolve();
}
