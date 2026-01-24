import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resolveEnv, resolveEnvRecursive } from './env-resolver.js';

describe('Env Resolver', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveEnv', () => {
    it('should resolve existing environment variable', () => {
      process.env.TEST_VAR = 'resolved_value';
      expect(resolveEnv('Value is ${TEST_VAR}')).toBe('Value is resolved_value');
    });

    it('should return string as is if no variables', () => {
      expect(resolveEnv('No variables here')).toBe('No variables here');
    });

    it('should throw error for missing environment variable', () => {
      delete process.env.MISSING_VAR;
      expect(() => resolveEnv('Value is ${MISSING_VAR}')).toThrow('Environment variable "MISSING_VAR" is not set');
    });

    it('should resolve multiple variables', () => {
      process.env.VAR1 = 'one';
      process.env.VAR2 = 'two';
      expect(resolveEnv('${VAR1} and ${VAR2}')).toBe('one and two');
    });
  });

  describe('resolveEnvRecursive', () => {
    it('should resolve variables in nested object', () => {
      process.env.HOST = 'localhost';
      process.env.PORT = '8080';

      const config = {
        server: {
          host: '${HOST}',
          port: '${PORT}',
        },
        static: 'static_value',
      };

      const resolved = resolveEnvRecursive(config);
      expect(resolved.server.host).toBe('localhost');
      expect(resolved.server.port).toBe('8080');
      expect(resolved.static).toBe('static_value');
    });

    it('should resolve variables in array', () => {
      process.env.ITEM1 = 'item1';
      const arr = ['static', '${ITEM1}'];
      const resolved = resolveEnvRecursive(arr);
      expect(resolved[0]).toBe('static');
      expect(resolved[1]).toBe('item1');
    });
  });
});
