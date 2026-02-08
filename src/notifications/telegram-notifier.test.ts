import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { NotificationLevel } from './notification-level';
import { TelegramNotifier } from './telegram-notifier';

describe('TelegramNotifier', () => {
  let notifier: TelegramNotifier;
  const config = {
    botToken: 'fake-token',
    chatId: 'fake-chat-id',
  };

  beforeEach(() => {
    notifier = new TelegramNotifier(config);
    global.fetch = mock(() => Promise.resolve(new Response('ok'))) as any;
    // Mock console.error to avoid noise
    spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should only send notifications for ERROR level', async () => {
    await notifier.notify(NotificationLevel.INFO, 'info message');
    expect(global.fetch).not.toHaveBeenCalled();

    await notifier.notify(NotificationLevel.SUCCESS, 'success message');
    expect(global.fetch).not.toHaveBeenCalled();

    await notifier.notify(NotificationLevel.WARNING, 'warning message');
    expect(global.fetch).not.toHaveBeenCalled();

    await notifier.notify(NotificationLevel.ERROR, 'error message');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should format message correctly', async () => {
    await notifier.notify(NotificationLevel.ERROR, 'error message');

    const calls = (global.fetch as any).mock.calls;
    const url = calls[0][0];
    const options = calls[0][1];
    const body = JSON.parse(options.body);

    expect(url).toBe('https://api.telegram.org/botfake-token/sendMessage');
    expect(body.chat_id).toBe('fake-chat-id');
    expect(body.text).toContain('❌ <b>wetvlo Error</b>');
    expect(body.text).toContain('<pre>error message</pre>');
    expect(body.parse_mode).toBe('HTML');
  });

  it('should escape HTML characters', async () => {
    await notifier.notify(NotificationLevel.ERROR, 'Error with <tags> & symbols');

    const calls = (global.fetch as any).mock.calls;
    const body = JSON.parse(calls[0][1].body);

    expect(body.text).toContain('&lt;tags&gt; &amp; symbols');
  });

  it('should truncate long messages', async () => {
    const longMessage = 'a'.repeat(5000);
    await notifier.notify(NotificationLevel.ERROR, longMessage);

    const calls = (global.fetch as any).mock.calls;
    const body = JSON.parse(calls[0][1].body);

    expect(body.text.length).toBeLessThan(4200); // 4096 is the limit, plus tags
    expect(body.text).toContain('(truncated)');
  });

  it('should handle fetch errors gracefully', async () => {
    global.fetch = mock(() => Promise.reject(new Error('Network error'))) as any;

    // Should not throw
    await notifier.notify(NotificationLevel.ERROR, 'error message');

    expect(console.error).toHaveBeenCalled();
  });

  it('should handle API errors gracefully', async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response('Bad Request', { status: 400, statusText: 'Bad Request' })),
    ) as any;

    // Should not throw
    await notifier.notify(NotificationLevel.ERROR, 'error message');

    expect(console.error).toHaveBeenCalled();
  });

  it('should ignore progress updates', async () => {
    await notifier.progress('progress');
    expect(global.fetch).not.toHaveBeenCalled();

    await notifier.endProgress();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
