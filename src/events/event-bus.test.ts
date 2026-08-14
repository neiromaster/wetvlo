/**
 * Tests for EventBus
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { EventBus, resetEventBus } from './event-bus';
import type { WetvloEvent } from './event-types';

beforeEach(() => {
  resetEventBus();
});

afterEach(() => {
  resetEventBus();
});

test('should emit and receive events', async () => {
  const bus = new EventBus();
  const received: WetvloEvent['app:start'][] = [];

  const unsubscribe = bus.on('app:start', (data) => {
    received.push(data);
  });

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  expect(received).toHaveLength(1);
  expect(received[0]?.version).toBe('1.0.0');

  unsubscribe();
});

test('should support multiple listeners', async () => {
  const bus = new EventBus();
  const results: string[] = [];

  const unsub1 = bus.on('app:start', () => {
    results.push('listener1');
  });

  const unsub2 = bus.on('app:start', () => {
    results.push('listener2');
  });

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  expect(results).toEqual(['listener1', 'listener2']);

  unsub1();
  unsub2();
});

test('should unsubscribe correctly', async () => {
  const bus = new EventBus();
  let callCount = 0;

  const unsubscribe = bus.on('app:start', () => {
    callCount++;
  });

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  unsubscribe();

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  expect(callCount).toBe(1);
});

test('should support onMany for multiple events', async () => {
  const bus = new EventBus();
  const received: string[] = [];

  const unsubscribe = bus.onMany({
    'app:start': () => {
      received.push('start');
    },
    'app:shutdown': () => {
      received.push('shutdown');
    },
  });

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  await bus.emit('app:shutdown', {
    reason: 'complete',
    timestamp: new Date(),
  });

  expect(received).toEqual(['start', 'shutdown']);

  unsubscribe();
});

test('should support onAny for all events', async () => {
  const bus = new EventBus();
  const received: Array<{ name: string; data: WetvloEvent[keyof WetvloEvent] }> = [];

  const unsubscribe = bus.onAny((data) => {
    received.push(data);
  });

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  await bus.emit('app:shutdown', {
    reason: 'complete',
    timestamp: new Date(),
  });

  expect(received).toHaveLength(2);
  expect(received[0]?.name).toBe('app:start');
  expect(received[1]?.name).toBe('app:shutdown');

  unsubscribe();
});

test('should support once for one-time listeners', async () => {
  const bus = new EventBus();
  let callCount = 0;

  bus.once('app:start', () => {
    callCount++;
  });

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  expect(callCount).toBe(1);
});

test('should support waitFor', async () => {
  const bus = new EventBus();

  // Call waitFor FIRST, then emit
  const waitForPromise = bus.waitFor('app:start');

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  const result = await waitForPromise;

  expect(result.version).toBe('1.0.0');
});

test('should support waitFor with filter', async () => {
  const bus = new EventBus();

  // Call waitFor FIRST, then emit
  const waitForPromise = bus.waitFor('app:start', (data) => data.version === '2.0.0');

  // Emit multiple events
  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  await bus.emit('app:start', {
    version: '2.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  const result = await waitForPromise;

  expect(result.version).toBe('2.0.0');
});

test('should support async iteration', async () => {
  const bus = new EventBus();
  const results: string[] = [];

  const iterate = async () => {
    for await (const data of bus.iterate('app:start')) {
      results.push(data.version);
      if (results.length === 2) break;
    }
  };

  const iterationPromise = iterate();

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  await bus.emit('app:start', {
    version: '2.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  await iterationPromise;

  expect(results).toEqual(['1.0.0', '2.0.0']);
});

test('should report listener count', () => {
  const bus = new EventBus();

  expect(bus.listenerCount('app:start')).toBe(0);

  const unsub1 = bus.on('app:start', () => {});
  expect(bus.listenerCount('app:start')).toBe(1);

  const unsub2 = bus.on('app:start', () => {});
  expect(bus.listenerCount('app:start')).toBe(2);

  unsub1();
  expect(bus.listenerCount('app:start')).toBe(1);

  unsub2();
  expect(bus.listenerCount('app:start')).toBe(0);
});

test('should clear listeners', async () => {
  const bus = new EventBus();
  let callCount = 0;

  bus.on('app:start', () => {
    callCount++;
  });

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  expect(callCount).toBe(1);

  bus.clearListeners('app:start');

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  expect(callCount).toBe(1); // No increment
});

test('should support emitSync for fire-and-forget', async () => {
  const bus = new EventBus();
  const received: WetvloEvent['app:start'][] = [];

  bus.on('app:start', (data) => {
    received.push(data);
  });

  // emitSync returns void immediately
  bus.emitSync('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  // Wait a bit for async delivery
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(received).toHaveLength(1);
});

test('should support AbortSignal for auto-unsubscribe', async () => {
  const bus = new EventBus();
  let callCount = 0;

  const controller = new AbortController();

  bus.onWithSignal(
    'app:start',
    () => {
      callCount++;
    },
    controller.signal,
  );

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  expect(callCount).toBe(1);

  controller.abort();

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  expect(callCount).toBe(1); // No increment after abort
});

test('should handle async handlers', async () => {
  const bus = new EventBus();
  const results: string[] = [];

  bus.on('app:start', async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    results.push('async1');
  });

  bus.on('app:start', async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    results.push('async2');
  });

  await bus.emit('app:start', {
    version: '1.0.0',
    config: './config.yaml',
    timestamp: new Date(),
  });

  expect(results).toHaveLength(2);
});

test('should get global singleton', () => {
  // We use getEventBus function
  const { getEventBus: getBus } = require('./event-bus');
  const bus1 = getBus();
  const bus2 = getBus();

  expect(bus1).toBeDefined();
  expect(bus1).toBe(bus2); // Same instance
});
