/** Keeps a search to letters, digits and spaces so it can't change the filter it goes into. */
export function searchTerm(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
}
