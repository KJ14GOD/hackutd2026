import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configPath, parseConfig } from './config';

describe('theseus.config.json', () => {
  const raw = JSON.parse(readFileSync(configPath(), 'utf8'));

  it('matches the schema', () => {
    expect(() => parseConfig(raw)).not.toThrow();
  });

  it('rejects a threshold outside 0..1', () => {
    const bad = structuredClone(raw);
    bad.traffic.thresholdShare = 1.5;
    expect(() => parseConfig(bad)).toThrow();
  });

  it('has a traffic rate for every catalogued endpoint used in scenarios', () => {
    const cfg = parseConfig(raw);
    for (const s of cfg.traffic.scenario) expect(cfg.traffic.ratesPerSimHour).toHaveProperty([s.endpointId]);
  });

  it('rejects ranking weights that are both zero', () => {
    const bad = structuredClone(raw);
    bad.ranking.trafficWeight = 0;
    bad.ranking.isolationWeight = 0;
    expect(() => parseConfig(bad)).toThrow();
  });

  it('keeps cutover steps ascending and ending at 100', () => {
    const { steps } = parseConfig(raw).cutover;
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(steps.at(-1)).toBe(100);
  });
});
