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
        stateFile: 'state.json',
        browser: 'chrome',
      };

      expect(() => validateConfig(validConfig)).not.toThrow();
      expect(validateConfigSafe(validConfig).success).toBe(true);
    });

    it('should fail on invalid series', () => {
      const invalidConfig = {
        series: [], // Empty array not allowed
        stateFile: 'state.json',
        browser: 'chrome',
      };

      expect(() => validateConfig(invalidConfig)).toThrow();
      const result = validateConfigSafe(invalidConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Cannot be empty');
      }
    });

    it('should fail on missing required fields', () => {
      const invalidConfig = {
        series: [{ name: 'Test', url: 'https://ex.com', startTime: '20:00' }],
        // Missing stateFile and browser
      };

      expect(() => validateConfig(invalidConfig)).toThrow();
    });
  });

  describe('Loader', () => {
    it('should load and parse valid YAML config', async () => {
      const yamlContent = `
series:
  - name: Test Series
    url: https://example.com
    startTime: "20:00"
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
      expect(config.telegram?.botToken).toBe('token123');
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
stateFile: state.json
browser: chrome
telegram:
  botToken: "\${TEST_TOKEN}"
  chatId: chat123
`;
      writeFileSync(absolutePath, yamlContent);

      const config = await loadConfig(testConfigFile);
      expect(config.telegram?.botToken).toBe('env-token-123');
    });
  });
});
