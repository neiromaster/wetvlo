/**
 * Utility to sanitize filenames for cross-platform compatibility
 * Specifically targets Windows restrictions which are stricter than *nix
 */
export function sanitizeFilename(name: string): string {
  return (
    name
      // Replace Windows illegal characters: < > : " / \ | ? *
      .replace(/[<>:"/\\|?*]/g, '_')
      // Remove control characters (0-31 in ASCII)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Needed to strip control characters
      .replace(/[\x00-\x1F]/g, '')
      // Remove trailing spaces and dots (Windows doesn't like them)
      .replace(/[\s.]+$/, '')
  );
}
