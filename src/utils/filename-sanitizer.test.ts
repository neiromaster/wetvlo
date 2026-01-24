import { describe, expect, it } from 'bun:test';
import { sanitizeFilename } from './filename-sanitizer';

describe('sanitizeFilename', () => {
  it('should replace illegal characters with underscores', () => {
    const input = 'File <with> : illegal "chars" / \\ | ? *';
    const expected = 'File _with_ _ illegal _chars_ _ _ _ _ _';
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('should remove control characters', () => {
    // eslint-disable-next-line no-control-regex
    const input = 'File\x00Name\x1F';
    const expected = 'FileName';
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('should remove trailing spaces and dots', () => {
    const input = 'File Name . ';
    const expected = 'File Name';
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('should keep valid characters unchanged', () => {
    const input = 'Valid-File_Name.123';
    const expected = 'Valid-File_Name.123';
    expect(sanitizeFilename(input)).toBe(expected);
  });
});
