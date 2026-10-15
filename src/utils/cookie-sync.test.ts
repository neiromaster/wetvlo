import { describe, expect, it } from 'bun:test';
import { isJunkCookieDomain } from './cookie-sync.js';

describe('isJunkCookieDomain', () => {
  it('marks host-prefixed dot-domains (.www.*) as junk', () => {
    expect(isJunkCookieDomain('.www.iq.com')).toBe(true);
    expect(isJunkCookieDomain('.www.firefox.com')).toBe(true);
    expect(isJunkCookieDomain('.www.base64decode.org')).toBe(true);
  });

  it('keeps legitimate domain cookies', () => {
    expect(isJunkCookieDomain('.iq.com')).toBe(false);
    expect(isJunkCookieDomain('.wetv.vip')).toBe(false);
    expect(isJunkCookieDomain('.mgtv.com')).toBe(false);
  });

  it('keeps host-only cookies whose host starts with www', () => {
    expect(isJunkCookieDomain('www.iq.com')).toBe(false);
    expect(isJunkCookieDomain('www.wetv.vip')).toBe(false);
  });

  it('keeps bare and empty domains', () => {
    expect(isJunkCookieDomain('iq.com')).toBe(false);
    expect(isJunkCookieDomain('')).toBe(false);
  });
});
