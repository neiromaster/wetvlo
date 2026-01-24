import { describe, expect, it, mock, spyOn } from 'bun:test';
import * as execaModule from 'execa';
import { VideoValidator } from './video-validator';

describe('VideoValidator', () => {
  it('should return duration for valid video', async () => {
    // Mock execa
    const execaMock = mock(() => Promise.resolve({ stdout: '123.45' }));
    spyOn(execaModule, 'execa').mockImplementation(execaMock as any);

    const duration = await VideoValidator.getVideoDuration('test.mp4');
    expect(duration).toBe(123.45);
    expect(execaMock).toHaveBeenCalledWith('ffprobe', [
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
    // Mock execa failure
    const execaMock = mock(() => Promise.reject(new Error('ffprobe not found')));
    spyOn(execaModule, 'execa').mockImplementation(execaMock as any);

    const duration = await VideoValidator.getVideoDuration('test.mp4');
    expect(duration).toBe(0);
  });

  it('should return 0 if output is not a number', async () => {
    // Mock execa returning invalid string
    const execaMock = mock(() => Promise.resolve({ stdout: 'invalid' }));
    spyOn(execaModule, 'execa').mockImplementation(execaMock as any);

    const duration = await VideoValidator.getVideoDuration('test.mp4');
    expect(duration).toBe(0);
  });
});
