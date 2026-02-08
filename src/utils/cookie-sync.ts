import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import type { Browser, BrowserContext, Cookie } from 'playwright';
import { chromium, firefox, webkit } from 'playwright';
import { AppContext } from '../app-context';
import { NotificationLevel } from '../notifications/notification-level.js';

type NetscapeCookie = {
  domain: string;
  includeSubdomains: boolean;
  path: string;
  secure: boolean;
  expiry: number;
  name: string;
  value: string;
};

/**
 * CookieRefreshManager - Singleton class for managing Playwright browser sessions
 *
 * Features:
 * - Lazy browser initialization (launches on first use)
 * - Debounce mechanism (closes browser after 15 minutes of inactivity)
 * - Concurrency control (mutex pattern with queue)
 * - Automatic cleanup on graceful shutdown
 *
 * Usage:
 *   const manager = CookieRefreshManager.getInstance();
 *   await manager.refreshCookies(seriesUrl);
 *   await manager.shutdown(); // For graceful shutdown
 */
export class CookieRefreshManager {
  private static instance: CookieRefreshManager;

  // Browser state
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  // Debounce state
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes

  // Concurrency control
  private refreshInProgress: Promise<void> | null = null;
  private pendingRefreshes: Array<{
    seriesUrl: string;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): CookieRefreshManager {
    if (!CookieRefreshManager.instance) {
      CookieRefreshManager.instance = new CookieRefreshManager();
    }
    return CookieRefreshManager.instance;
  }

  /**
   * Main API: Refresh cookies for a series URL
   *
   * - Initializes browser if needed (lazy init)
   * - Queues request if refresh already in progress
   * - Resets inactivity timer
   *
   * @param seriesUrl - Series URL to refresh cookies for
   */
  async refreshCookies(seriesUrl: string): Promise<void> {
    // If refresh is already in progress, queue the request
    if (this.refreshInProgress) {
      return new Promise<void>((resolve, reject) => {
        this.pendingRefreshes.push({ seriesUrl, resolve, reject });
      });
    }

    // Start new refresh
    this.refreshInProgress = (async () => {
      try {
        await this.performRefresh(seriesUrl);
        this.resetCleanupTimer();
      } finally {
        this.refreshInProgress = null;
        await this.processPendingRefreshes();
      }
    })();

    return this.refreshInProgress;
  }

  /**
   * Force immediate cleanup (for graceful shutdown)
   */
  async shutdown(): Promise<void> {
    await this.closeBrowser();
  }

  /**
   * Reinitialize browser (for config reload)
   *
   * Closes the current browser so that the next refresh will use the new config.
   * This ensures that changes to cookieRefreshBrowser or playwrightHeadless take effect.
   */
  async reinitialize(): Promise<void> {
    const notifier = AppContext.getNotifier();
    notifier.notify(NotificationLevel.DEBUG, 'Reinitializing cookie refresh browser due to config reload');
    await this.closeBrowser();
  }

  /**
   * Perform the actual cookie refresh for a series URL
   */
  private async performRefresh(seriesUrl: string): Promise<void> {
    const configRegistry = AppContext.getConfig();
    const notifier = AppContext.getNotifier();
    const config = configRegistry.resolve(seriesUrl, 'series');

    const cookieFile = config.cookieFile;
    const refreshBrowser = config.cookieRefreshBrowser;

    // Early return if not configured
    if (!cookieFile) {
      notifier.notify(NotificationLevel.DEBUG, 'No cookieFile configured');
      return;
    }

    if (!refreshBrowser) {
      notifier.notify(NotificationLevel.DEBUG, 'No cookieRefreshBrowser configured');
      return;
    }

    const headless = config.playwrightHeadless ?? true;

    // Initialize browser if needed
    if (!this.browser) {
      await this.initializeBrowser(refreshBrowser, headless, notifier);
    }

    if (!this.context) {
      throw new Error('Browser context not initialized');
    }

    // Load existing cookies into context
    await this.loadCookiesIntoContext(this.context, cookieFile, notifier);

    // Navigate to series page
    const page = await this.context.newPage();
    try {
      await page.goto(seriesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await this.saveContextCookies(this.context, cookieFile, notifier);
    } finally {
      await page.close();
    }
  }

  /**
   * Process pending refresh requests from the queue
   */
  private async processPendingRefreshes(): Promise<void> {
    if (this.pendingRefreshes.length === 0) {
      return;
    }

    const notifier = AppContext.getNotifier();
    notifier.notify(
      NotificationLevel.DEBUG,
      `Processing ${this.pendingRefreshes.length} pending cookie refresh requests`,
    );

    // Process all pending requests
    const requests = this.pendingRefreshes.splice(0);

    // We'll process them one at a time
    for (const request of requests) {
      try {
        await this.performRefresh(request.seriesUrl);
        this.resetCleanupTimer();
        request.resolve();
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        request.reject(errorObj);
      }
    }
  }

  /**
   * Initialize browser (lazy initialization)
   */
  private async initializeBrowser(
    browserType: string,
    headless: boolean,
    notifier: import('../notifications/notifier.js').Notifier,
  ): Promise<void> {
    const playwrightBrowser = this.mapBrowserToPlaywright(browserType);

    notifier.notify(NotificationLevel.INFO, `Launching Playwright browser (${browserType}) for cookie refresh...`);
    this.browser = await playwrightBrowser.launch({ headless });
    this.context = await this.browser.newContext();
    notifier.notify(NotificationLevel.SUCCESS, 'Playwright browser launched for cookie refresh');
  }

  /**
   * Close browser and cleanup timer
   */
  private async closeBrowser(): Promise<void> {
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Close context
    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    // Close browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    const notifier = AppContext.getNotifier();
    notifier.notify(NotificationLevel.INFO, 'Playwright browser closed for cookie refresh');
  }

  /**
   * Reset inactivity cleanup timer
   */
  private resetCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
    }

    this.cleanupTimer = setTimeout(async () => {
      await this.closeBrowser();
    }, this.INACTIVITY_TIMEOUT);
  }

  /**
   * Load cookies from file into browser context
   */
  private async loadCookiesIntoContext(
    context: BrowserContext,
    cookieFile: string,
    notifier: import('../notifications/notifier.js').Notifier,
  ): Promise<void> {
    if (!existsSync(cookieFile)) {
      notifier.notify(NotificationLevel.WARNING, `Cookie file not found at ${cookieFile}, skipping import`);
      return;
    }
    const content = await readFile(cookieFile, 'utf-8');
    const netscape = this.parseNetscapeCookies(content);
    const playwrightCookies = this.toPlaywrightCookies(netscape);
    if (playwrightCookies.length > 0) {
      await context.addCookies(playwrightCookies);
      notifier.notify(NotificationLevel.INFO, `Imported ${playwrightCookies.length} cookies into Playwright context`);
    }
  }

  /**
   * Save cookies from browser context to file
   *
   * Saves ALL cookies from the browser context (not just current domain).
   * The context contains all cookies because existing cookies are loaded
   * into it before navigation.
   */
  private async saveContextCookies(
    context: BrowserContext,
    cookieFile: string,
    notifier: import('../notifications/notifier.js').Notifier,
  ): Promise<void> {
    // Get ALL cookies from context (no filtering!)
    const allCookies = await context.cookies();

    // Write all cookies to file
    const serialized = this.serializeNetscapeCookies(allCookies);
    await writeFile(cookieFile, serialized, 'utf-8');

    notifier.notify(NotificationLevel.SUCCESS, `Saved ${allCookies.length} cookies to ${cookieFile}`);
  }

  /**
   * Parse Netscape cookie file format
   */
  private parseNetscapeCookies(content: string): NetscapeCookie[] {
    const lines = content.split('\n');
    const cookies: NetscapeCookie[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split('\t');
      if (parts.length < 7) continue;
      const [domain = '', flag = 'FALSE', path = '/', secure = 'FALSE', expiry = '0', name = '', value = ''] = parts;
      cookies.push({
        domain,
        includeSubdomains: flag.toUpperCase() === 'TRUE',
        path,
        secure: secure.toUpperCase() === 'TRUE',
        expiry: Number(expiry) || 0,
        name,
        value,
      });
    }
    return cookies;
  }

  /**
   * Convert Netscape cookies to Playwright format
   */
  private toPlaywrightCookies(nc: NetscapeCookie[]): Cookie[] {
    return nc.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      expires: c.expiry || -1,
      httpOnly: false,
      secure: c.secure,
      sameSite: 'Lax',
    }));
  }

  /**
   * Serialize cookies to Netscape format
   */
  private serializeNetscapeCookies(cookies: Cookie[]): string {
    const lines: string[] = [];
    lines.push('# Netscape HTTP Cookie File');
    lines.push('# This file is generated by Wetvlo via Playwright. Do not edit.');
    lines.push('');
    for (const c of cookies) {
      const domain = c.domain || '';
      const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
      const path = c.path || '/';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const expires = typeof c.expires === 'number' ? Math.max(0, Math.floor(c.expires)) : 0;
      const name = c.name;
      const value = c.value;
      lines.push([domain, includeSubdomains, path, secure, String(expires), name, value].join('\t'));
    }
    return lines.join('\n');
  }

  /**
   * Map browser name to Playwright browser type
   */
  private mapBrowserToPlaywright(browser?: string) {
    switch ((browser || 'chrome').toLowerCase()) {
      case 'chrome':
      case 'chromium':
      case 'edge':
        return chromium;
      case 'firefox':
        return firefox;
      case 'safari':
        return webkit;
      default:
        return chromium;
    }
  }
}
