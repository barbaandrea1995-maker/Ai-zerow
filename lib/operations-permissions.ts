/**
 * Report writing is reserved for explicit report writers, operations writers,
 * or field leads who can also read the authoritative workforce registry.
 * Keep this predicate shared by the server page and APIs so the Presenze
 * handoff cannot disagree with the write boundary.
 */
export function canWriteOperationsRapportino(capabilities: readonly string[]) {
  return capabilities.includes("operations.write")
    || capabilities.includes("operations.rapportino.write")
    || (capabilities.includes("field.write") && capabilities.includes("workforce.registry.read"));
}
