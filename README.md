# OpenAct ⚡

> **The `yt-dlp` for turning any website or portal into a fast, deterministic REST API, CLI command, and AI Agent (MCP) tool.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP Ready](https://img.shields.io/badge/MCP-2024--11--05-10b981.svg)](https://modelcontextprotocol.io/)
[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1.0-6ba539.svg)](https://spec.openapis.org/oas/v3.1.0)

Most websites, portals, and SaaS dashboards either don't offer a public API or lock API access behind a $50,000/year "Enterprise Plan." Meanwhile, AI browser agents ("Computer Use") take 45+ seconds, cost $0.50–$2.00 per run, and hallucinate clicks.

**OpenAct** takes the proven community architecture of `yt-dlp` and applies it to structured web data and actions:
1. **Declarative `.act.yaml` Blueprints:** A single ~40-line YAML file (with optional TypeScript hooks) defines inputs, extraction logic, output schemas, and automated verification tests.
2. **3-Tier Execution Engine with Automatic Fallback:**
   - **Tier 1 (`http` — 20–80ms):** Direct JSON/REST/GraphQL replay with templated inputs and local Session Vault cookies/headers.
   - **Tier 2 (`extract` — 50–150ms):** Fast HTML parsing via Next.js/Nuxt Hydration blobs (`__NEXT_DATA__`), `Schema.org` JSON-LD (`application/ld+json`), OpenGraph metadata, and Cheerio CSS selectors—**zero headless browser overhead**.
   - **Tier 3 (`browser` — Playwright):** Full headless Chromium automation and live background XHR/Fetch JSON interception when a site requires JavaScript execution.
3. **1 Blueprint = 4 Interfaces Automatically:**
   - **REST API + Live OpenAPI 3.1 Spec** (`POST /api/v1/run/:namespace/:name`)
   - **Model Context Protocol (MCP) Server** (`openact mcp` for Claude Desktop, Cursor, Windsurf, OpenHands)
   - **Ergonomic CLI** (`openact run developer/github-trending --input language=typescript`)
   - **Interactive Web Studio UI** (`http://localhost:4100`)

---

## Built-in Community Blueprints

OpenAct ships with **12 verified blueprints** across 4 categories out of the box:

| Blueprint ID | Tier | Description |
| :--- | :--- | :--- |
| `developer/github-trending` | `extract` (CSS) | Trending GitHub repositories by language & time window (`daily`, `weekly`, `monthly`) |
| `developer/github-releases` | `http` + `extract` fallback | Latest releases for any GitHub repository with automatic HTML fallback |
| `developer/hackernews-search` | `http` | Search Hacker News stories, `Ask HN`, and `Show HN` threads |
| `developer/npm-package` | `http` | NPM Registry metadata, version, license, types, and repository URL |
| `developer/pypi-package` | `http` | PyPI Python package metadata, latest version, and Python requirements |
| `knowledge/wikipedia-summary` | `http` | Structured summary, description, and thumbnail for any Wikipedia article |
| `knowledge/dictionary-lookup` | `http` | Wiktionary definitions, parts of speech, and usage examples |
| `knowledge/webpage-metadata` | `extract` (Meta) | Universal OpenGraph, Twitter Card, title, and canonical URL extractor |
| `community/devto-articles` | `http` | Top developer articles and tutorials from DEV.to by tag |
| `community/lobsters-stories` | `http` | Hottest and newest computing stories from Lobste.rs |
| `utilities/open-meteo-weather` | `http` | Real-time weather, temperature, humidity, and wind speed by coordinates |
| `utilities/exchange-rates` | `http` + `.hook.ts` | Global currency exchange rates with TypeScript transform hook enrichment |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. List all installed community blueprints
npx tsx src/cli/main.ts list

# 3. Run all offline fixture tests (or add --live to test against live websites)
npx tsx src/cli/main.ts test
npx tsx src/cli/main.ts test --live

# 4. Run any blueprint from the CLI
npx tsx src/cli/main.ts run developer/github-trending --input language=typescript --input since=daily

# 5. Launch the OpenAct REST Server, OpenAPI 3.1 Spec & Web Studio UI
npm run serve
# -> Open http://localhost:4100
```

---

## Reverse-Engineering New Sites in Seconds

OpenAct ships with two built-in compilers so you never have to write a blueprint from scratch:

### 1. Live URL Inspector (`openact inspect <url>`)
Automatically probes any URL for direct JSON, `__NEXT_DATA__` hydration state, `Schema.org` JSON-LD, OpenGraph tags, and repeating DOM card/row structures, and outputs a ready-to-run `.act.yaml` blueprint:

```bash
npx tsx src/cli/main.ts inspect https://news.ycombinator.com --save
```

### 2. Browser HAR-to-API Compiler (`openact import-har <file.har>`)
Export a `.har` file from Chrome/Firefox DevTools ("Save all as HAR with content"), and OpenAct filters out static assets, ranks the underlying JSON API endpoints, infers query inputs and output schemas, and generates a Tier-1 `http` blueprint:

```bash
npx tsx src/cli/main.ts import-har capture.har --save
```

---

## Local Encrypted Session Vault (`AES-256-GCM`)

Need to run a blueprint against a portal you're logged into? Store your cookies, headers, or API tokens in OpenAct's local `AES-256-GCM` encrypted vault (`.openact/vault.enc.json`) so credentials never touch your YAML files or git history:

```bash
# Save headers, cookies, or {{vault.secret}} values locally
npx tsx src/cli/main.ts vault set github \
  --domain api.github.com \
  --header "Authorization=Bearer ghp_xxx"

# List encrypted profiles
npx tsx src/cli/main.ts vault list
```

---

## Connect to AI Agents (Model Context Protocol)

Every blueprint in `blueprints/` is automatically exposed as a deterministic MCP tool:

```json
{
  "mcpServers": {
    "openact": {
      "command": "npx",
      "args": ["tsx", "/path/to/openact/src/cli/main.ts", "mcp"]
    }
  }
}
```

---

## Contributing Blueprints

OpenAct grows through community-contributed blueprints! Adding support for a new website takes **1 file** in `blueprints/<category>/<name>.act.yaml`. See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the 3-minute guide.

## License

MIT © OpenAct Contributors
