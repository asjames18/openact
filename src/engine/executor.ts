import { CacheAndRateLimiter } from '../cache/cache-store.js';
import { LoadedBlueprint } from '../registry/loader.js';
import {
  Blueprint,
  ExecutionSpec,
  validateBlueprintOutput,
} from '../schema/blueprint.js';
import { SessionVault } from '../vault/session-vault.js';
import { TemplateContext, resolveBlueprintInputs } from './template.js';
import { executeTier1Http } from './tier1-http.js';
import { executeTier2Extract } from './tier2-extract.js';
import { executeTier3Browser } from './tier3-browser.js';

export interface ExecutionOptions {
  inputs?: Record<string, unknown>;
  bypassCache?: boolean;
  vaultProfileOverride?: string;
  mockResponse?: unknown;
}

export interface ExecutionResult<T = unknown> {
  blueprintId: string;
  inputs: Record<string, unknown>;
  data: T;
  meta: {
    tierUsed: 'http' | 'extract' | 'browser';
    cached: boolean;
    cacheAgeSeconds?: number;
    fallbackUsed: boolean;
    durationMs: number;
    validation: {
      valid: boolean;
      errors: string[];
    };
  };
}

/**
 * Core OpenAct Orchestrator:
 * Resolves inputs, checks cache & rate limits, injects Session Vault secrets/cookies,
 * executes the 3-Tier pipeline with automatic fallback cascade, runs optional TS hooks,
 * and validates the structured output.
 */
export class BlueprintExecutor {
  private readonly cache: CacheAndRateLimiter;
  private readonly vault: SessionVault;

  constructor(options?: { cache?: CacheAndRateLimiter; vault?: SessionVault }) {
    this.cache = options?.cache ?? new CacheAndRateLimiter();
    this.vault = options?.vault ?? new SessionVault();
  }

  public async execute<T = unknown>(
    loaded: LoadedBlueprint | Blueprint,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult<T>> {
    const startTime = performance.now();
    const blueprint = 'blueprint' in loaded ? loaded.blueprint : loaded;
    const hook = 'hook' in loaded ? loaded.hook : undefined;

    // 1. Validate & resolve input parameters
    const resolvedInputs = resolveBlueprintInputs(blueprint, options.inputs ?? {});

    // 2. Check deterministic cache unless bypassed or running mock tests
    if (!options.bypassCache && options.mockResponse === undefined) {
      const hit = this.cache.get<T>(blueprint.id, resolvedInputs);
      if (hit) {
        const validation = validateBlueprintOutput(hit.data, blueprint.output);
        return {
          blueprintId: blueprint.id,
          inputs: resolvedInputs,
          data: hit.data,
          meta: {
            tierUsed: hit.tierUsed as 'http' | 'extract' | 'browser',
            cached: true,
            cacheAgeSeconds: hit.ageSeconds,
            fallbackUsed: false,
            durationMs: Math.round(performance.now() - startTime),
            validation,
          },
        };
      }
    }

    // 3. Enforce rate limit
    if (options.mockResponse === undefined && blueprint.rateLimit?.requestsPerMinute) {
      this.cache.checkRateLimit(blueprint.id, blueprint.rateLimit.requestsPerMinute);
    }

    // 4. Prepare Session Vault context
    const profileName = options.vaultProfileOverride ?? blueprint.vaultProfile;
    const vaultHeaders = this.vault.getRequestHeaders(profileName);
    const vaultSecrets = this.vault.getMergedSecrets(profileName);
    const storageState = profileName
      ? this.vault.getProfile(profileName)?.storageState
      : undefined;

    const ctx: TemplateContext = {
      inputs: resolvedInputs,
      vault: vaultSecrets,
      env: process.env,
    };

    // 5. Execute primary specification with automatic fallback cascade
    const { rawOutput, tierUsed, fallbackUsed } = await this.runWithFallback(
      blueprint.execution,
      ctx,
      vaultHeaders,
      storageState,
      options.mockResponse
    );

    // 6. Run optional TypeScript/JavaScript transform hook if present
    const finalData = (
      hook ? await hook(rawOutput, { inputs: resolvedInputs, blueprint }) : rawOutput
    ) as T;

    // 7. Validate against Blueprint Output Schema
    const validation = validateBlueprintOutput(finalData, blueprint.output);

    // 8. Populate cache if valid and not a mock test
    if (
      options.mockResponse === undefined &&
      !options.bypassCache &&
      blueprint.cacheTtlSeconds > 0 &&
      validation.valid
    ) {
      this.cache.set(
        blueprint.id,
        resolvedInputs,
        finalData,
        blueprint.cacheTtlSeconds,
        tierUsed
      );
    }

    return {
      blueprintId: blueprint.id,
      inputs: resolvedInputs,
      data: finalData,
      meta: {
        tierUsed,
        cached: false,
        fallbackUsed,
        durationMs: Math.round(performance.now() - startTime),
        validation,
      },
    };
  }

  private async runWithFallback(
    spec: ExecutionSpec,
    ctx: TemplateContext,
    vaultHeaders: Record<string, string>,
    storageState?: Record<string, unknown>,
    mockResponse?: unknown,
    isFallback: boolean = false
  ): Promise<{
    rawOutput: unknown;
    tierUsed: 'http' | 'extract' | 'browser';
    fallbackUsed: boolean;
  }> {
    try {
      const rawOutput = await this.runSingleSpec(
        spec,
        ctx,
        vaultHeaders,
        storageState,
        mockResponse
      );
      return {
        rawOutput,
        tierUsed: spec.mode,
        fallbackUsed: isFallback,
      };
    } catch (primaryErr) {
      if (spec.fallback) {
        return this.runWithFallback(
          spec.fallback,
          ctx,
          vaultHeaders,
          storageState,
          mockResponse,
          true
        );
      }
      throw primaryErr;
    }
  }

  private async runSingleSpec(
    spec: ExecutionSpec,
    ctx: TemplateContext,
    vaultHeaders: Record<string, string>,
    storageState?: Record<string, unknown>,
    mockResponse?: unknown
  ): Promise<unknown> {
    switch (spec.mode) {
      case 'http':
        return executeTier1Http({
          requestSpec: spec.request,
          httpSpec: spec.http,
          ctx,
          vaultHeaders,
          mockResponse,
        });
      case 'extract':
        return executeTier2Extract({
          requestSpec: spec.request,
          extractSpec: spec.extract,
          ctx,
          vaultHeaders,
          mockResponse,
        });
      case 'browser':
        return executeTier3Browser({
          requestSpec: spec.request,
          browserSpec: spec.browser,
          ctx,
          vaultHeaders,
          storageState,
          mockResponse,
        });
      default:
        throw new Error(`Unsupported execution mode: "${String((spec as ExecutionSpec).mode)}"`);
    }
  }

  public getCache(): CacheAndRateLimiter {
    return this.cache;
  }

  public getVault(): SessionVault {
    return this.vault;
  }
}
