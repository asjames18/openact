# Contributing to OpenAct

Thank you for helping build the open-source library of deterministic web APIs!

Just like `yt-dlp`, **90% of contributions to OpenAct are single-file Blueprints** located in `blueprints/<category>/<name>.act.yaml`. You don't need to touch the core engine to add a new website or portal.

---

## How to Add a New Blueprint in 3 Minutes

### Step 1: Generate a Draft Blueprint Automatically
Run the built-in URL Inspector or HAR Compiler:

```bash
# Option A: Inspect a public webpage for JSON-LD, Hydration state, or CSS lists
npx tsx src/cli/main.ts inspect https://example.com/directory --save

# Option B: Compile a captured browser HAR file into a Tier-1 HTTP blueprint
npx tsx src/cli/main.ts import-har my-session.har --save
```

### Step 2: Refine the `.act.yaml` File
Open your blueprint in `blueprints/<category>/<name>.act.yaml` and ensure it includes:
1. **`id`**: `category/name` (lowercase alphanumeric with hyphens)
2. **`inputs`**: Typed input parameters with sensible `default` values and `description`s
3. **`execution`**:
   - Prefer `mode: http` (Tier 1) or `mode: extract` (Tier 2) whenever possible for sub-100ms execution without launching Chromium.
   - Use `fallback:` if you want a Tier-1 API call to automatically fall back to Tier-2 HTML extraction when rate-limited!
4. **`output`**: Output schema (`object` or `array`) so OpenAct can auto-generate OpenAPI 3.1 docs and validate responses.
5. **`tests`**: Add at least **1 offline fixture test** using `mockResponse` so CI can deterministically verify your extraction selectors/paths in `<10ms`.

### Step 3: Optional TypeScript Transform Hook
If a website returns a complex structure that needs custom post-processing beyond declarative transforms, create a sidecar file with the exact same base name:
`blueprints/<category>/<name>.hook.ts`:

```typescript
export function transform(raw: unknown, ctx: { inputs: Record<string, unknown> }) {
  // Return transformed data matching your blueprint's output schema
  return raw;
}
```

### Step 4: Validate & Run Tests

```bash
# 1. Validate YAML schema across all blueprints
npm run validate

# 2. Run offline fixture tests
npx tsx src/cli/main.ts test

# 3. Test live execution
npx tsx src/cli/main.ts run <your-namespace>/<your-blueprint>
```
