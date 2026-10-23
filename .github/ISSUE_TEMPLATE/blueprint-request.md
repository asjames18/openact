---
name: "🌐 New Blueprint Request"
about: "Request or propose a deterministic .act.yaml blueprint for a website or API"
title: "[Blueprint]: <Website / Service Name> — <Action or Data to Extract>"
labels: ["good first issue", "enhancement"]
assignees: ""
---

## Target Website or Service
- **Website / URL:** `https://example.com/...`
- **Category:** `developer` / `knowledge` / `community` / `utilities` / `finance` / `commerce`
- **Proposed Blueprint ID:** `<category>/<name>`

## What Data or Action Should This Blueprint Provide?
Describe what fields should be extracted or what action should be executed.

## Recommended Execution Tier (if known)
- [ ] **Tier 1 (`http`):** Direct JSON / GraphQL / XHR endpoint
- [ ] **Tier 2 (`extract`):** HTML CSS selectors, `Schema.org` JSON-LD, Next.js `__NEXT_DATA__`, or OpenGraph metadata
- [ ] **Tier 3 (`browser`):** Playwright headless browser actions / network interception

## Sample Input Parameters
- `query` (string, optional)
- `limit` (number, default: 10)
