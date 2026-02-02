import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config-loader.js';
import { validateConfig, validateConfigSafe } from './config-schema.js';

describe('Config', () => {
  const testConfigFile = `config-test-${Date.now()}.yaml`;
  const absolutePath = join(process.cwd(), testConfigFile);

  afterEach(() => {
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }
  });

  describe('Validation', () => {
    it('should validate correct config', () => {
      const validConfig = {
        series: [
          {
            name: 'Test Series',
            url: 'https://example.com',
            startTime: '20:00',
          },
        ],
        domainConfigs: [
          {
            domain: 'example.com',
            stateFile: 'state.json',
            check: {
              checkInterval: 60,
              downloadTypes: ['available', 'vip'],
            },
          },
        ],
        globalConfig: {
          stateFile: 'state.json',
          browser: 'chrome',
        },
      };

      expect(() => validateConfig(validConfig)).not.toThrow();
      expect(validateConfigSafe(validConfig).success).toBe(true);
    });

    it('should fail on invalid series', () => {
      const invalidConfig = {
        series: [], // Empty array not allowed
        domainConfigs: [
          {
            domain: 'example.com',
            stateFile: 'state.json',
          },
        ],
        globalConfig: {
          stateFile: 'state.json',
          browser: 'chrome',
        },
      };

      expect(() => validateConfig(invalidConfig)).toThrow();
      const result = validateConfigSafe(invalidConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Cannot be empty');
      }
    });

    // Note: stateFile is optional in domainConfigs after schema refactoring
    // This test is no longer relevant
  });

  describe('Loader', () => {
    it('should load and parse valid YAML config', async () => {
      const yamlContent = `
series:
  - name: Test Series
    url: https://example.com
    startTime: "20:00"
globalConfig:
  stateFile: state.json
  browser: chrome
  telegram:
    botToken: token123
    chatId: chat123
`;
      writeFileSync(absolutePath, yamlContent);

      const config = await loadConfig(testConfigFile);
      expect(config.series).toHaveLength(1);
      expect(config.series[0]?.name).toBe('Test Series');
      expect(config.globalConfig?.telegram?.botToken).toBe('token123');
    });

    it('should throw if file not found', async () => {
      expect(loadConfig('non-existent.yaml')).rejects.toThrow('Configuration file not found');
    });

    it('should resolve environment variables', async () => {
      process.env.TEST_TOKEN = 'env-token-123';
      const yamlContent = `
series:
  - name: Test Series
    url: https://example.com
    startTime: "20:00"
globalConfig:
  stateFile: state.json
  browser: chrome
  telegram:
    botToken: "\${TEST_TOKEN}"
    chatId: chat123
`;
      writeFileSync(absolutePath, yamlContent);

      const config = await loadConfig(testConfigFile);
      expect(config.globalConfig?.telegram?.botToken).toBe('env-token-123');
    });
  });
});
