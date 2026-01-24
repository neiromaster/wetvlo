import { describe, expect, it } from 'bun:test';
import { formatDuration, getMsUntilTime, parseTime, sleep } from './time-utils.js';

describe('Time Utils', () => {
  describe('parseTime', () => {
    it('should parse valid HH:MM time', () => {
      const date = parseTime('14:30');
      expect(date.getHours()).toBe(14);
      expect(date.getMinutes()).toBe(30);
    });

    it('should throw error for invalid format', () => {
      expect(() => parseTime('1430')).toThrow('Invalid time format');
      expect(() => parseTime('invalid')).toThrow('Invalid time format');
    });

    it('should throw error for invalid hours', () => {
      expect(() => parseTime('25:00')).toThrow('Invalid hours');
    });

    it('should throw error for invalid minutes', () => {
      expect(() => parseTime('12:60')).toThrow('Invalid minutes');
    });
  });

  describe('getMsUntilTime', () => {
    it('should return positive milliseconds', () => {
      // Mock Date to ensure deterministic behavior if needed,
      // but strictly "positive" is enough for basic sanity check
      const ms = getMsUntilTime('23:59');
      expect(ms).toBeGreaterThan(0);
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(5000)).toBe('5s');
    });

    it('should format minutes', () => {
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('should format hours', () => {
      expect(formatDuration(3665000)).toBe('1h 1m');
    });

    it('should format days', () => {
      expect(formatDuration(90000000)).toBe('1d 1h');
    });
  });

  describe('sleep', () => {
    it('should wait for specified duration', async () => {
      const start = Date.now();
      await sleep(10);
      const end = Date.now();
      expect(end - start).toBeGreaterThanOrEqual(9); // Allow small margin
    });
  });
});
