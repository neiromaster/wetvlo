import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { getVideoDuration } from './video-validator';

// Mock execa
const mockExeca = mock();
mock.module('execa', () => ({
  execa: mockExeca,
}));

describe('VideoValidator', () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  it('should return duration for valid video', async () => {
    mockExeca.mockResolvedValue({ stdout: '123.45' });

    const duration = await getVideoDuration('test.mp4');
    expect(duration).toBe(123.45);
    expect(mockExeca).toHaveBeenCalledWith('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      'test.mp4',
    ]);
  });

  it('should return 0 if ffprobe fails', async () => {
    mockExeca.mockRejectedValue(new Error('ffprobe not found'));

    const duration = await getVideoDuration('test.mp4');
    expect(duration).toBe(0);
  });

  it('should return 0 if output is not a number', async () => {
    mockExeca.mockResolvedValue({ stdout: 'invalid' });

    const duration = await getVideoDuration('test.mp4');
    expect(duration).toBe(0);
  });
});
