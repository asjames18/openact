## Summary

Describe the new Blueprint or engine improvement included in this Pull Request.

## Blueprint Checklist (if adding or updating a `.act.yaml` blueprint)

- [ ] Blueprint ID follows `<category>/<name>` format (lowercase alphanumeric and hyphens)
- [ ] Prefers Tier 1 (`http`) or Tier 2 (`extract`) over Tier 3 (`browser`) where possible
- [ ] Includes an `output` schema definition
- [ ] Includes at least one offline fixture test under `tests:` with `mockResponse`
- [ ] Passed `npm run validate` and `npx tsx src/cli/main.ts test` locally
