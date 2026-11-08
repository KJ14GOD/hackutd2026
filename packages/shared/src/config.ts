// Loader and schema for theseus.config.json, the one file that holds every tunable.
// The SpacetimeDB module cannot read files, so `pnpm config:push` sends this same
// JSON to the `set_config` reducer; reducers read it from the `config` table.
// If you add a key here, document it in docs/DATA_MODEL.md (Config section).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

const EdgeWeights = z.object({
  call: z.number().nonnegative(),
  file: z.number().nonnegative(),
  table: z.number().nonnegative(),
  copybook: z.number().nonnegative(),
  cochange: z.number().nonnegative(),
});

export const ConfigSchema = z.object({
  sim: z.object({
    startIso: z.string(),
    defaultSpeed: z.number().positive(),
  }),
  ports: z.object({
    router: z.number().int(),
    legacyPrimary: z.number().int(),
    legacySecondary: z.number().int(),
    target: z.number().int(),
  }),
  traffic: z.object({
    bucketSimMinutes: z.number().int().positive(),
    windowSimMinutes: z.number().int().positive(),
    thresholdShare: z.number().min(0).max(1),
    minWindowRequests: z.number().int().nonnegative(),
    maxParallelJobs: z.number().int().positive(),
    flushMs: z.number().int().positive(),
    maxRealRps: z.number().positive(),
    seed: z.number().int(),
    ratesPerSimHour: z.record(z.string(), z.number().nonnegative()),
    scenario: z.array(
      z.object({
        fromSimMinute: z.number(),
        toSimMinute: z.number(),
        endpointId: z.string(),
        multiplier: z.number().nonnegative(),
      }),
    ),
    accounts: z.object({ ids: z.array(z.number().int()), weights: z.array(z.number().nonnegative()) }),
    amountRange: z.tuple([z.number(), z.number()]),
  }),
  // Which pocket migrates first. A pocket is eligible when its traffic share >= traffic.thresholdShare
  // and its isolation >= minIsolation. Eligible pockets start in order of
  // priority = trafficWeight * trafficShare + isolationWeight * isolation (docs/AGENT_LOOP.md).
  ranking: z
    .object({
      trafficWeight: z.number().min(0).max(1),
      isolationWeight: z.number().min(0).max(1),
      minIsolation: z.number().min(0).max(1),
    })
    .refine((r) => r.trafficWeight + r.isolationWeight > 0, 'ranking weights cannot both be 0'),
  segmentation: z.object({
    seed: z.number().int(),
    resolution: z.object({ pocket: z.number().positive(), domain: z.number().positive() }),
    edgeWeights: EdgeWeights,
    hubDampening: z.boolean(),
    omnipresentThreshold: z.number().min(0).max(1),
    cochange: z.object({ maxFilesPerCommit: z.number().int().positive(), minCount: z.number().int().positive() }),
  }),
  shadow: z.object({
    mismatchCapPerFlush: z.number().int().nonnegative(),
    maxStoredMismatchesPerJob: z.number().int().nonnegative(),
    matchRateEventDelta: z.number().nonnegative(),
    noiseMinHits: z.number().int().positive(),
  }),
  cutover: z.object({
    steps: z.array(z.number().int().min(0).max(100)),
    minMatchRate: z.number().min(0).max(1),
    criticalMinMatchRate: z.number().min(0).max(1),
    minSamplesPerStep: z.number().int().nonnegative(),
  }),
  selfHeal: z.object({
    samplePercent: z.number().min(0).max(100),
    windowSamples: z.number().int().positive(),
    rollbackMismatchRate: z.number().min(0).max(1),
  }),
  deadCode: z.object({ simDays: z.number().positive() }),
  humanLoop: z.object({
    maxQuestionsPerPersonPerSimDay: z.number().int().nonnegative(),
    escalation: z.object({
      backupAfterSimMinutes: z.number().nonnegative(),
      channelAfterSimMinutes: z.number().nonnegative(),
    }),
  }),
  // requestsPerMinute: NVIDIA's hosted API rate-limits per account; the client paces itself under this.
  llm: z.object({ cacheDir: z.string(), maxFixAttempts: z.number().int().positive(), requestsPerMinute: z.number().positive() }),
  // Part 2 reader (docs/SPEC_DEPENDENCY_PASSES.md §3): pack size, answer size, extra-context rounds.
  part2: z.object({
    maxPackTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    maxNeedMoreRounds: z.number().int().nonnegative(),
    maxExtraTokens: z.number().int().positive(),
    concurrency: z.number().int().positive(),
  }),
  // Requirements layer (docs/REQUIREMENTS_ANALYSIS.md §15). Authority: weights per ownership signal,
  // commit half-life, and the score an active person with access needs to become an approver.
  requirements: z.object({
    authority: z.object({
      weights: z.object({
        namedCodeOwner: z.number(), policyOwner: z.number(), managerOfOwningTeam: z.number(), commits: z.number(),
        ticketReporter: z.number(), specAuthor: z.number(), ticketAssignee: z.number(), chatParticipant: z.number(), teamCodeOwner: z.number(),
      }),
      commitHalfLifeDays: z.number().positive(),
      approverThreshold: z.number().nonnegative(),
    }),
    // Phase 4 lookups: judge calls at once (NVIDIA rate-limits bursts) and documents read per question.
    context: z.object({ concurrency: z.number().int().positive(), maxDocsPerQuestion: z.number().int().positive() }),
    // Phase 5 worker: pause between steps so the live feed reads as a story, and the programs it runs by default.
    harness: z.object({ stepDelayMs: z.number().int().nonnegative(), demoPrograms: z.array(z.string()) }),
  }),
  // Rewrite + shadow (services/rewrite): javac fix passes, mismatch-driven fix passes, and the Java file's token budget.
  // gateThreshold: the match rate a program needs before cutover may start.
  rewrite: z.object({ maxCompileFixes: z.number().int().nonnegative(), maxDiffFixes: z.number().int().nonnegative(), maxOutputTokens: z.number().int().positive(), gateThreshold: z.number().min(0).max(1) }),
});

export type TheseusConfig = z.infer<typeof ConfigSchema>;

/** Walks up from `start` until it finds the repo root (the dir holding theseus.config.json). */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'theseus.config.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`theseus.config.json not found above ${start}`);
    dir = parent;
  }
}

export function configPath(): string {
  return process.env.THESEUS_CONFIG ?? join(findRepoRoot(), 'theseus.config.json');
}

export function parseConfig(raw: unknown): TheseusConfig {
  return ConfigSchema.parse(raw);
}

let cached: TheseusConfig | undefined;

/** Reads and validates the config file once per process. */
export function loadConfig(): TheseusConfig {
  cached ??= parseConfig(JSON.parse(readFileSync(configPath(), 'utf8')));
  return cached;
}

/** Loads `.env` from the repo root into process.env if it exists (Node >= 21). */
export function loadEnv(): void {
  const file = join(findRepoRoot(), '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}
