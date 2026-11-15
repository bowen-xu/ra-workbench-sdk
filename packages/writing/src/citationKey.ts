export interface CitationKeySeed {
  readonly importedKey?: string;
  readonly firstAuthor?: string;
  readonly issuedYear?: number;
  readonly title?: string;
}

const VALID_KEY = /^[A-Za-z][A-Za-z0-9_:+.-]*$/;

export function isValidCitationKey(value: string): boolean {
  return value.length <= 128 && VALID_KEY.test(value);
}

export function createStableCitationKey(
  seed: CitationKeySeed,
  occupiedKeys: ReadonlySet<string>,
): string {
  const imported = seed.importedKey?.trim();
  const base = imported && isValidCitationKey(imported) ? imported.toLowerCase() : generatedBase(seed);
  const occupied = new Set([...occupiedKeys].map(key => key.toLowerCase()));

  if (!occupied.has(base)) return base;

  let suffix = 2;
  const candidate = () => `${base.slice(0, 128 - String(suffix).length)}${suffix}`;
  while (occupied.has(candidate())) suffix += 1;
  return candidate();
}

function generatedBase(seed: CitationKeySeed): string {
  const author = asciiToken(seed.firstAuthor ?? "");
  const year = seed.issuedYear?.toString() ?? "";
  const titleWord = (seed.title ?? "")
    .split(/\s+/u)
    .map(asciiToken)
    .find((token) => token.length > 2) ?? "";
  const combined = `${author}${year}${titleWord}`;
  return isValidCitationKey(combined) ? combined : "reference";
}

function asciiToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
}
