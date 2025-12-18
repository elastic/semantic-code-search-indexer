/**
 * Some file extensions are intentionally shared across multiple languages.
 *
 * These are not configuration mistakes, so we suppress "duplicate extension" warnings
 * only for the explicitly allowed language sets below.
 */
const SHARED_EXTENSION_LANGUAGE_SETS = new Map<string, ReadonlySet<string>>([['.h', new Set(['c', 'cpp'])]]);

export function isSharedExtensionAllowed(suffix: string, languageA: string, languageB: string): boolean {
  const normalizedSuffix = suffix.toLowerCase();
  const normalizedA = languageA.toLowerCase();
  const normalizedB = languageB.toLowerCase();

  const allowedLanguages = SHARED_EXTENSION_LANGUAGE_SETS.get(normalizedSuffix);
  if (!allowedLanguages) {
    return false;
  }

  return allowedLanguages.has(normalizedA) && allowedLanguages.has(normalizedB);
}
