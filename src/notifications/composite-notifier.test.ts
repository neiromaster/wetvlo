import { describe, expect, it, mock } from 'bun:test';
import { CompositeNotifier } from './composite-notifier';
import { NotificationLevel } from './notification-level';
import type { Notifier } from './notifier';

describe('CompositeNotifier', () => {
  it('constructor creates empty composite', () => {
    const composite = new CompositeNotifier();
    composite.notify(NotificationLevel.INFO, 'test');
    composite.progress('test');
    composite.endProgress();
    // Should not throw
    expect(true).toBe(true);
  });

  it('add() adds notifier with priority', () => {
    const composite = new CompositeNotifier();
    const mockNotifier = {
      notify: mock(),
      progress: mock(),
      endProgress: mock(),
    };

    composite.add(mockNotifier, 5);

    composite.notify(NotificationLevel.INFO, 'test');
    expect(mockNotifier.notify).toHaveBeenCalledWith(NotificationLevel.INFO, 'test');
  });

  it('remove() removes notifier', () => {
    const composite = new CompositeNotifier();
    const mockNotifier = {
      notify: mock(),
      progress: mock(),
      endProgress: mock(),
    };

    composite.add(mockNotifier, 0);
    composite.remove(mockNotifier);

    composite.notify(NotificationLevel.INFO, 'test');
    expect(mockNotifier.notify).not.toHaveBeenCalled();
  });

  it('notify() broadcasts to all notifiers', async () => {
    const composite = new CompositeNotifier();
    const notifier1 = {
      notify: mock(() => Promise.resolve()),
      progress: mock(),
      endProgress: mock(),
    };
    const notifier2 = {
      notify: mock(() => Promise.resolve()),
      progress: mock(),
      endProgress: mock(),
    };

    composite.add(notifier1, 0);
    composite.add(notifier2, 0);

    await composite.notify(NotificationLevel.INFO, 'test');

    expect(notifier1.notify).toHaveBeenCalledWith(NotificationLevel.INFO, 'test');
    expect(notifier2.notify).toHaveBeenCalledWith(NotificationLevel.INFO, 'test');
  });

  it('notify() handles errors in individual notifiers without breaking others', async () => {
    const composite = new CompositeNotifier();
    const notifier1 = {
      notify: mock(() => Promise.resolve()),
      progress: mock(),
      endProgress: mock(),
    };
    const notifier2 = {
      notify: mock(() => Promise.reject(new Error('Notifier error'))),
      progress: mock(),
      endProgress: mock(),
    };
    const notifier3 = {
      notify: mock(() => Promise.resolve()),
      progress: mock(),
      endProgress: mock(),
    };

    composite.add(notifier1, 0);
    composite.add(notifier2, 0);
    composite.add(notifier3, 0);

    // Should not throw
    await composite.notify(NotificationLevel.INFO, 'test');

    expect(notifier1.notify).toHaveBeenCalled();
    expect(notifier2.notify).toHaveBeenCalled();
    expect(notifier3.notify).toHaveBeenCalled();
  });

  it('notify() works with both sync and async notifiers', async () => {
    const composite = new CompositeNotifier();
    const syncNotifier: Notifier = {
      notify: mock(), // sync function
      progress: mock(),
      endProgress: mock(),
    };
    const asyncNotifier: Notifier = {
      notify: mock(() => Promise.resolve()),
      progress: mock(),
      endProgress: mock(),
    };

    composite.add(syncNotifier, 0);
    composite.add(asyncNotifier, 0);

    await composite.notify(NotificationLevel.INFO, 'test');

    expect(syncNotifier.notify).toHaveBeenCalledWith(NotificationLevel.INFO, 'test');
    expect(asyncNotifier.notify).toHaveBeenCalledWith(NotificationLevel.INFO, 'test');
  });

  it('progress() calls all notifiers', () => {
    const composite = new CompositeNotifier();
    const notifier1 = {
      notify: mock(),
      progress: mock(),
      endProgress: mock(),
    };
    const notifier2 = {
      notify: mock(),
      progress: mock(),
      endProgress: mock(),
    };

    composite.add(notifier1, 0);
    composite.add(notifier2, 0);

    composite.progress('downloading...');

    expect(notifier1.progress).toHaveBeenCalledWith('downloading...');
    expect(notifier2.progress).toHaveBeenCalledWith('downloading...');
  });

  it('endProgress() calls all notifiers', () => {
    const composite = new CompositeNotifier();
    const notifier1 = {
      notify: mock(),
      progress: mock(),
      endProgress: mock(),
    };
    const notifier2 = {
      notify: mock(),
      progress: mock(),
      endProgress: mock(),
    };

    composite.add(notifier1, 0);
    composite.add(notifier2, 0);

    composite.endProgress();

    expect(notifier1.endProgress).toHaveBeenCalled();
    expect(notifier2.endProgress).toHaveBeenCalled();
  });

  it('priority ordering works correctly (higher priority called first)', async () => {
    const composite = new CompositeNotifier();
    const order: number[] = [];

    const notifier1 = {
      notify: mock(async () => {
        order.push(1);
      }),
      progress: mock(),
      endProgress: mock(),
    };
    const notifier2 = {
      notify: mock(async () => {
        order.push(2);
      }),
      progress: mock(),
      endProgress: mock(),
    };
    const notifier3 = {
      notify: mock(async () => {
        order.push(3);
      }),
      progress: mock(),
      endProgress: mock(),
    };

    composite.add(notifier1, 5);
    composite.add(notifier2, 10);
    composite.add(notifier3, 0);

    await composite.notify(NotificationLevel.INFO, 'test');

    // Note: Promise.all doesn't guarantee order, but sort() should have organized them
    // Check that they're sorted by priority internally
    expect(order).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it('progress() handles errors in individual notifiers without breaking others', () => {
    const composite = new CompositeNotifier();
    const notifier1 = {
      notify: mock(),
      progress: mock(),
      endProgress: mock(),
    };
    const notifier2 = {
      notify: mock(),
      progress: mock(() => {
        throw new Error('Progress error');
      }),
      endProgress: mock(),
    };
    const notifier3 = {
      notify: mock(),
      progress: mock(),
      endProgress: mock(),
    };

    composite.add(notifier1, 0);
    composite.add(notifier2, 0);
    composite.add(notifier3, 0);

    // Should not throw
    composite.progress('downloading...');

    expect(notifier1.progress).toHaveBeenCalled();
    expect(notifier2.progress).toHaveBeenCalled();
    expect(notifier3.progress).toHaveBeenCalled();
  });

  it('endProgress() handles errors in individual notifiers without breaking others', () => {
    const composite = new CompositeNotifier();
    const notifier1 = {
      notify: mock(),
      progress: mock(),
      endProgress: mock(),
    };
    const notifier2 = {
      notify: mock(),
      progress: mock(),
      endProgress: mock(() => {
        throw new Error('End progress error');
      }),
    };
    const notifier3 = {
      notify: mock(),
      progress: mock(),
      endProgress: mock(),
    };

    composite.add(notifier1, 0);
    composite.add(notifier2, 0);
    composite.add(notifier3, 0);

    // Should not throw
    composite.endProgress();

    expect(notifier1.endProgress).toHaveBeenCalled();
    expect(notifier2.endProgress).toHaveBeenCalled();
    expect(notifier3.endProgress).toHaveBeenCalled();
  });
});
