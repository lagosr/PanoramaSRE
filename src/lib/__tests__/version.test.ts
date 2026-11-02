import { describe, it, expect } from 'vitest';
import { APP_VERSION_INFO } from '../version';

describe('APP_VERSION_INFO', () => {
  it('provides a semantic version and git build hash', () => {
    expect(APP_VERSION_INFO.version).toBeDefined();
    expect(APP_VERSION_INFO.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(APP_VERSION_INFO.buildHash).toBeDefined();
    expect(APP_VERSION_INFO.fullVersionString).toContain(APP_VERSION_INFO.version);
  });

  it('build stamp includes hash', () => {
    expect(APP_VERSION_INFO.buildStamp).toContain(APP_VERSION_INFO.buildHash);
  });
});
