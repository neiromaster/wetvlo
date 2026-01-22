/**
 * Extract domain from URL
 *
 * @param url - URL to extract domain from
 * @returns Domain (e.g., "wetv.vip")
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    throw new Error(`Invalid URL: "${url}"`);
  }
}

/**
 * Check if URL is valid
 *
 * @param url - URL to validate
 * @returns True if URL is valid
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize URL by removing trailing slash and fragment
 *
 * @param url - URL to normalize
 * @returns Normalized URL
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    urlObj.hash = '';
    // Remove trailing slash from pathname
    if (urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    return urlObj.toString();
  } catch {
    return url;
  }
}
