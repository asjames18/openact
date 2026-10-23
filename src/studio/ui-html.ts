/**
 * Embedded Single-Page Web Studio UI for OpenAct (`http://localhost:4100`).
 * Provides interactive Blueprint Playground, Live URL Inspector, HAR-to-API Compiler,
 * Encrypted Session Vault Manager, and OpenAPI/MCP integration snippets.
 */
export function getStudioHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OpenAct Studio — Turn Any Website into a Deterministic API</title>
  <style>
    :root {
      --bg: #0b0f17;
      --bg-panel: #111827;
      --bg-card: #1a2234;
      --bg-input: #0f172a;
      --border: #26324d;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0ea5e9;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --purple: #a855f7;
      --font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(17, 24, 39, 0.92);
      border-bottom: 1px solid var(--border);
      padding: 0.85rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 20;
      backdrop-filter: blur(8px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .brand-logo {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: linear-gradient(135deg, #38bdf8, #6366f1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 1.05rem;
      color: #fff;
      box-shadow: 0 0 18px rgba(56, 189, 248, 0.35);
    }
    .brand h1 { font-size: 1.15rem; font-weight: 700; letter-spacing: -0.02em; }
    .brand span {
      font-size: 0.78rem;
      color: var(--text-muted);
      background: var(--bg-card);
      border: 1px solid var(--border);
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
    }
    .nav-tabs {
      display: flex;
      gap: 0.4rem;
    }
    .tab-btn {
      background: transparent;
      color: var(--text-muted);
      border: 1px solid transparent;
      padding: 0.45rem 0.9rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .tab-btn:hover { color: var(--text); background: var(--bg-card); }
    .tab-btn.active {
      color: var(--accent);
      background: rgba(56, 189, 248, 0.12);
      border-color: rgba(56, 189, 248, 0.35);
    }
    .header-links {
      display: flex;
      gap: 0.65rem;
      align-items: center;
    }
    .pill-link {
      font-size: 0.78rem;
      color: var(--text-muted);
      text-decoration: none;
      border: 1px solid var(--border);
      padding: 0.35rem 0.7rem;
      border-radius: 6px;
      background: var(--bg-card);
    }
    .pill-link:hover { color: var(--text); border-color: var(--accent); }
    main {
      flex: 1;
      display: flex;
      overflow: hidden;
      height: calc(100vh - 63px);
    }
    .tab-view {
      display: none;
      width: 100%;
      height: 100%;
    }
    .tab-view.active { display: flex; }

    /* Sidebar */
    .sidebar {
      width: 340px;
      background: var(--bg-panel);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .sidebar-search {
      padding: 0.9rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }
    input, select, textarea {
      background: var(--bg-input);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.55rem 0.75rem;
      border-radius: 6px;
      font-size: 0.86rem;
      outline: none;
      font-family: inherit;
    }
    input:focus, select:focus, textarea:focus {
      border-color: var(--accent);
    }
    .blueprint-list {
      flex: 1;
      overflow-y: auto;
      padding: 0.6rem;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }
    .bp-item {
      padding: 0.75rem 0.85rem;
      border-radius: 8px;
      border: 1px solid transparent;
      background: rgba(26, 34, 52, 0.5);
      cursor: pointer;
      transition: all 0.15s;
    }
    .bp-item:hover { background: var(--bg-card); border-color: var(--border); }
    .bp-item.active {
      background: rgba(56, 189, 248, 0.1);
      border-color: var(--accent);
    }
    .bp-item-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.25rem;
    }
    .bp-id {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--accent);
    }
    .badge {
      font-size: 0.66rem;
      font-weight: 700;
      text-transform: uppercase;
      padding: 0.12rem 0.42rem;
      border-radius: 4px;
      letter-spacing: 0.03em;
    }
    .badge-http { background: rgba(16, 185, 129, 0.18); color: #34d399; }
    .badge-extract { background: rgba(56, 189, 248, 0.18); color: #38bdf8; }
    .badge-browser { background: rgba(168, 85, 247, 0.18); color: #c084fc; }
    .bp-name { font-size: 0.88rem; font-weight: 600; margin-bottom: 0.2rem; }
    .bp-desc {
      font-size: 0.76rem;
      color: var(--text-muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* Main Workspace */
    .workspace {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 1.5rem;
      gap: 1.25rem;
    }
    .panel-card {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.25rem;
    }
    .bp-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 1rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    .bp-title-group h2 { font-size: 1.25rem; margin-bottom: 0.3rem; }
    .bp-title-group p { color: var(--text-muted); font-size: 0.88rem; line-height: 1.45; }
    .inputs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 0.9rem;
      margin-bottom: 1rem;
    }
    .field-group { display: flex; flex-direction: column; gap: 0.3rem; }
    .field-group label {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
    }
    .field-group small { font-size: 0.72rem; color: #64748b; }
    .action-bar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .btn {
      background: var(--accent);
      color: #020617;
      font-weight: 700;
      font-size: 0.85rem;
      padding: 0.58rem 1.15rem;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover { border-color: var(--accent); background: #222d44; }
    .metrics-row {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin-bottom: 0.9rem;
    }
    .metric-chip {
      font-size: 0.78rem;
      background: var(--bg-card);
      border: 1px solid var(--border);
      padding: 0.3rem 0.65rem;
      border-radius: 6px;
      font-family: var(--font-mono);
    }
    .output-tabs {
      display: flex;
      gap: 0.4rem;
      margin-bottom: 0.75rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.5rem;
    }
    pre.code-box {
      background: #070a10;
      border: 1px solid var(--border);
      padding: 1rem;
      border-radius: 8px;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      line-height: 1.5;
      overflow-x: auto;
      max-height: 460px;
      color: #e2e8f0;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }
    table.data-table th, table.data-table td {
      border: 1px solid var(--border);
      padding: 0.5rem 0.65rem;
      text-align: left;
      vertical-align: top;
    }
    table.data-table th {
      background: var(--bg-card);
      color: var(--accent);
      font-family: var(--font-mono);
    }
    .container-centered {
      max-width: 1080px;
      width: 100%;
      margin: 0 auto;
      padding: 1.5rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-logo">OA</div>
      <h1>OpenAct Studio</h1>
      <span id="bpCountBadge">Loading...</span>
    </div>
    <nav class="nav-tabs">
      <button class="tab-btn active" onclick="switchMainTab('playground', this)">Playground & Registry</button>
      <button class="tab-btn" onclick="switchMainTab('inspector', this)">URL Inspector & Compiler</button>
      <button class="tab-btn" onclick="switchMainTab('har', this)">HAR-to-API Compiler</button>
      <button class="tab-btn" onclick="switchMainTab('vault', this)">Session Vault</button>
      <button class="tab-btn" onclick="switchMainTab('integrations', this)">MCP & OpenAPI</button>
    </nav>
    <div class="header-links">
      <a class="pill-link" href="/api/v1/openapi.json" target="_blank">OpenAPI 3.1 Spec ↗</a>
    </div>
  </header>

  <main>
    <!-- TAB 1: PLAYGROUND -->
    <section id="tab-playground" class="tab-view active">
      <aside class="sidebar">
        <div class="sidebar-search">
          <input type="text" id="searchInput" placeholder="Search blueprints (e.g. github, weather)..." oninput="renderSidebar()" />
          <select id="categoryFilter" onchange="renderSidebar()">
            <option value="">All Categories</option>
          </select>
        </div>
        <div class="blueprint-list" id="blueprintList"></div>
      </aside>

      <div class="workspace" id="playgroundWorkspace">
        <div class="panel-card">
          <div class="bp-header">
            <div class="bp-title-group">
              <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.35rem;">
                <span id="activeBpId" class="bp-id"></span>
                <span id="activeBpTier" class="badge"></span>
              </div>
              <h2 id="activeBpName">Select a blueprint</h2>
              <p id="activeBpDesc"></p>
            </div>
          </div>

          <div id="inputsContainer" class="inputs-grid"></div>

          <div class="action-bar">
            <button class="btn" id="runBtn" onclick="runSelectedBlueprint(false)">▶ Run Blueprint</button>
            <button class="btn btn-secondary" onclick="runSelectedBlueprint(true)">↻ Run (Bypass Cache)</button>
          </div>
        </div>

        <div class="panel-card">
          <div class="metrics-row" id="metricsRow" style="display:none;"></div>
          <div class="output-tabs">
            <button class="tab-btn active" id="outTabJson" onclick="switchOutputView('json')">JSON Response</button>
            <button class="tab-btn" id="outTabTable" onclick="switchOutputView('table')">Table View</button>
            <button class="tab-btn" id="outTabSnippets" onclick="switchOutputView('snippets')">cURL / CLI / MCP</button>
            <button class="tab-btn" id="outTabYaml" onclick="switchOutputView('yaml')">Blueprint YAML</button>
          </div>
          <div id="outputViewJson">
            <pre class="code-box" id="jsonOutputBox">// Click "Run Blueprint" to execute deterministically.</pre>
          </div>
          <div id="outputViewTable" style="display:none;overflow-x:auto;"></div>
          <div id="outputViewSnippets" style="display:none;">
            <pre class="code-box" id="snippetsOutputBox"></pre>
          </div>
          <div id="outputViewYaml" style="display:none;">
            <pre class="code-box" id="yamlOutputBox"></pre>
          </div>
        </div>
      </div>
    </section>

    <!-- TAB 2: URL INSPECTOR -->
    <section id="tab-inspector" class="tab-view">
      <div class="container-centered">
        <div class="panel-card">
          <h2 style="margin-bottom:0.4rem;">Live URL Inspector & Blueprint Compiler</h2>
          <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:1rem;">
            Probe any URL for direct JSON, Next.js/Nuxt hydration blobs, Schema.org JSON-LD, OpenGraph metadata, and repeating DOM structures — and auto-compile a deterministic <code>.act.yaml</code> blueprint.
          </p>
          <div style="display:flex;gap:0.75rem;">
            <input type="url" id="inspectUrlInput" style="flex:1;" value="https://news.ycombinator.com" placeholder="https://example.com" />
            <button class="btn" id="inspectBtn" onclick="runUrlInspector()">🔍 Inspect & Generate Blueprint</button>
          </div>
        </div>

        <div class="panel-card" id="inspectorResultCard" style="display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.85rem;">
            <div class="metrics-row" id="inspectorSummaryBadges" style="margin-bottom:0;"></div>
            <button class="btn" onclick="saveInspectedBlueprint()">💾 Save Blueprint to Registry</button>
          </div>
          <textarea id="inspectorYamlEditor" rows="20" style="width:100%;font-family:var(--font-mono);font-size:0.8rem;"></textarea>
        </div>
      </div>
    </section>

    <!-- TAB 3: HAR COMPILER -->
    <section id="tab-har" class="tab-view">
      <div class="container-centered">
        <div class="panel-card">
          <h2 style="margin-bottom:0.4rem;">HAR-to-API Blueprint Compiler</h2>
          <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:1rem;">
            Paste a browser HAR JSON export (or upload a <code>.har</code> file). OpenAct filters out static assets, ranks the underlying JSON/GraphQL API calls, infers input & output schemas, and generates a Tier-1 HTTP Blueprint.
          </p>
          <div style="display:flex;gap:0.75rem;margin-bottom:0.75rem;">
            <input type="text" id="harFilterInput" placeholder="Optional URL substring filter (e.g. /api/v1)" style="flex:1;" />
            <button class="btn btn-secondary" onclick="loadSampleHar()">Load Demo HAR</button>
            <button class="btn" onclick="compileHarInput()">⚡ Compile HAR to Blueprint</button>
          </div>
          <textarea id="harJsonInput" rows="10" style="width:100%;font-family:var(--font-mono);font-size:0.78rem;" placeholder='{"log": {"entries": [...]}}'></textarea>
        </div>

        <div class="panel-card" id="harResultCard" style="display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.85rem;">
            <div id="harSummaryInfo" class="metrics-row" style="margin-bottom:0;"></div>
            <button class="btn" onclick="saveHarBlueprint()">💾 Save Compiled Blueprint to Registry</button>
          </div>
          <textarea id="harYamlEditor" rows="18" style="width:100%;font-family:var(--font-mono);font-size:0.8rem;"></textarea>
        </div>
      </div>
    </section>

    <!-- TAB 4: SESSION VAULT -->
    <section id="tab-vault" class="tab-view">
      <div class="container-centered">
        <div class="panel-card">
          <h2 style="margin-bottom:0.4rem;">Local Encrypted Session Vault (AES-256-GCM)</h2>
          <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:1rem;">
            Store site cookies, auth headers, and <code>{{vault.*}}</code> secrets encrypted on your local disk (<code>.openact/vault.enc.json</code>). Blueprints with <code>vaultProfile</code> automatically inject these credentials without exposing them in YAML files.
          </p>
          <div class="inputs-grid">
            <div class="field-group">
              <label>Profile Name</label>
              <input type="text" id="vaultName" placeholder="e.g. github or default" />
            </div>
            <div class="field-group">
              <label>Domain (Optional)</label>
              <input type="text" id="vaultDomain" placeholder="e.g. api.github.com" />
            </div>
            <div class="field-group">
              <label>Headers JSON</label>
              <input type="text" id="vaultHeaders" placeholder='{"Authorization": "Bearer ..."}' />
            </div>
            <div class="field-group">
              <label>Secrets JSON ({{vault.key}})</label>
              <input type="text" id="vaultSecrets" placeholder='{"apiKey": "secret-123"}' />
            </div>
          </div>
          <button class="btn" onclick="saveVaultProfile()">🔒 Save Encrypted Profile</button>
        </div>

        <div class="panel-card">
          <h3 style="margin-bottom:0.75rem;">Saved Vault Profiles</h3>
          <div id="vaultProfilesList"></div>
        </div>
      </div>
    </section>

    <!-- TAB 5: MCP & OPENAPI -->
    <section id="tab-integrations" class="tab-view">
      <div class="container-centered">
        <div class="panel-card">
          <h2 style="margin-bottom:0.4rem;">Connect OpenAct to AI Agents (Model Context Protocol)</h2>
          <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:1rem;">
            Every blueprint in your <code>blueprints/</code> directory is automatically exposed as a deterministic MCP tool. Add this to your Claude Desktop, Cursor, or Antigravity MCP configuration:
          </p>
          <pre class="code-box">{
  "mcpServers": {
    "openact": {
      "command": "npx",
      "args": ["tsx", "/home/mit-home/Documents/openact/src/cli/main.ts", "mcp"]
    }
  }
}</pre>
        </div>
        <div class="panel-card">
          <h2 style="margin-bottom:0.4rem;">REST API & OpenAPI 3.1 Specification</h2>
          <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:0.75rem;">
            Every blueprint is immediately callable over HTTP GET or POST at <code>/api/v1/run/:namespace/:name</code>, and documented in the live OpenAPI 3.1 schema at <a href="/api/v1/openapi.json" target="_blank" style="color:var(--accent);">/api/v1/openapi.json</a>.
          </p>
        </div>
      </div>
    </section>
  </main>

  <script>
    let allBlueprints = [];
    let selectedBlueprint = null;
    let lastExecutionData = null;

    async function loadBlueprints() {
      const res = await fetch('/api/v1/blueprints');
      const data = await res.json();
      allBlueprints = data.blueprints || [];
      document.getElementById('bpCountBadge').textContent = allBlueprints.length + ' Blueprints Ready';

      const categories = [...new Set(allBlueprints.map(b => b.category))].sort();
      const catSelect = document.getElementById('categoryFilter');
      const currentVal = catSelect.value;
      catSelect.innerHTML = '<option value="">All Categories (' + allBlueprints.length + ')</option>' +
        categories.map(c => '<option value="' + c + '">' + c + '</option>').join('');
      catSelect.value = currentVal;

      renderSidebar();
      if (!selectedBlueprint && allBlueprints.length > 0) {
        selectBlueprint(allBlueprints[0].id);
      } else if (selectedBlueprint) {
        selectBlueprint(selectedBlueprint.id);
      }
    }

    function renderSidebar() {
      const q = document.getElementById('searchInput').value.toLowerCase();
      const cat = document.getElementById('categoryFilter').value;
      const listEl = document.getElementById('blueprintList');

      const filtered = allBlueprints.filter(b => {
        if (cat && b.category !== cat) return false;
        if (!q) return true;
        return b.id.toLowerCase().includes(q) ||
               b.name.toLowerCase().includes(q) ||
               b.description.toLowerCase().includes(q);
      });

      listEl.innerHTML = filtered.map(b => {
        const isActive = selectedBlueprint && selectedBlueprint.id === b.id;
        const badgeClass = b.mode === 'http' ? 'badge-http' : b.mode === 'extract' ? 'badge-extract' : 'badge-browser';
        return '<div class="bp-item ' + (isActive ? 'active' : '') + '" onclick="selectBlueprint(\\'' + b.id + '\\')">' +
          '<div class="bp-item-top">' +
            '<span class="bp-id">' + b.id + '</span>' +
            '<span class="badge ' + badgeClass + '">' + b.mode + '</span>' +
          '</div>' +
          '<div class="bp-name">' + b.name + '</div>' +
          '<div class="bp-desc">' + b.description + '</div>' +
        '</div>';
      }).join('');
    }

    async function selectBlueprint(id) {
      const res = await fetch('/api/v1/blueprints/' + id);
      const detail = await res.json();
      selectedBlueprint = detail.blueprint;
      renderSidebar();

      document.getElementById('activeBpId').textContent = selectedBlueprint.id;
      const tierEl = document.getElementById('activeBpTier');
      const mode = selectedBlueprint.execution.mode;
      tierEl.textContent = 'TIER: ' + mode.toUpperCase() + (selectedBlueprint.execution.fallback ? ' + FALLBACK' : '') + (detail.hasHook ? ' + TS HOOK' : '');
      tierEl.className = 'badge ' + (mode === 'http' ? 'badge-http' : mode === 'extract' ? 'badge-extract' : 'badge-browser');

      document.getElementById('activeBpName').textContent = selectedBlueprint.name;
      document.getElementById('activeBpDesc').textContent = selectedBlueprint.description;
      document.getElementById('yamlOutputBox').textContent = detail.yaml || '';

      const inputsContainer = document.getElementById('inputsContainer');
      const inputEntries = Object.entries(selectedBlueprint.inputs || {});
      if (inputEntries.length === 0) {
        inputsContainer.innerHTML = '<div style="color:var(--text-muted);font-size:0.84rem;">No input parameters required.</div>';
      } else {
        inputsContainer.innerHTML = inputEntries.map(([key, spec]) => {
          const defVal = spec.default !== undefined ? spec.default : '';
          let control = '';
          if (spec.enum && spec.enum.length > 0) {
            control = '<select id="inp_' + key + '">' +
              spec.enum.map(opt => '<option value="' + opt + '" ' + (opt === defVal ? 'selected' : '') + '>' + opt + '</option>').join('') +
              '</select>';
          } else {
            control = '<input type="' + (spec.type === 'number' ? 'number' : 'text') + '" id="inp_' + key + '" value="' + defVal + '" placeholder="' + (spec.description || key) + '" />';
          }
          return '<div class="field-group">' +
            '<label><span>' + key + (spec.required ? ' *' : '') + '</span><span>' + spec.type + '</span></label>' +
            control +
            (spec.description ? '<small>' + spec.description + '</small>' : '') +
          '</div>';
        }).join('');
      }
      updateSnippets();
    }

    function collectInputs() {
      if (!selectedBlueprint) return {};
      const inputs = {};
      for (const [key, spec] of Object.entries(selectedBlueprint.inputs || {})) {
        const el = document.getElementById('inp_' + key);
        if (!el) continue;
        inputs[key] = spec.type === 'number' && el.value !== '' ? Number(el.value) : el.value;
      }
      return inputs;
    }

    function updateSnippets() {
      if (!selectedBlueprint) return;
      const inputs = collectInputs();
      const cliFlags = Object.entries(inputs)
        .filter(([, v]) => v !== '' && v !== undefined)
        .map(([k, v]) => '--input ' + k + '="' + v + '"')
        .join(' ');
      const curlUrl = window.location.origin + '/api/v1/run/' + selectedBlueprint.id;
      const mcpTool = 'openact__' + selectedBlueprint.id.replace(/\\//g, '__').replace(/-/g, '_');

      document.getElementById('snippetsOutputBox').textContent =
        '# 1. Run via OpenAct CLI\\n' +
        'npx tsx src/cli/main.ts run ' + selectedBlueprint.id + (cliFlags ? ' ' + cliFlags : '') + '\\n\\n' +
        '# 2. Call via REST API (cURL)\\n' +
        'curl -X POST ' + curlUrl + ' \\\\\\n' +
        '  -H "Content-Type: application/json" \\\\\\n' +
        '  -d \\'' + JSON.stringify({ inputs }) + '\\'\\n\\n' +
        '# 3. Call via Model Context Protocol (MCP Tool Name)\\n' +
        'Tool: ' + mcpTool + '\\n' +
        'Arguments: ' + JSON.stringify(inputs, null, 2);
    }

    async function runSelectedBlueprint(bypassCache) {
      if (!selectedBlueprint) return;
      const runBtn = document.getElementById('runBtn');
      runBtn.disabled = true;
      runBtn.textContent = '⏳ Running...';
      updateSnippets();

      try {
        const inputs = collectInputs();
        const res = await fetch('/api/v1/run/' + selectedBlueprint.id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs, bypassCache })
        });
        const result = await res.json();
        lastExecutionData = result.data;

        document.getElementById('jsonOutputBox').textContent = JSON.stringify(result, null, 2);
        const metricsRow = document.getElementById('metricsRow');
        metricsRow.style.display = 'flex';
        if (result.meta) {
          metricsRow.innerHTML =
            '<span class="metric-chip">⚡ Latency: <b>' + result.meta.durationMs + 'ms</b></span>' +
            '<span class="metric-chip">🛠 Tier Used: <b>' + result.meta.tierUsed.toUpperCase() + '</b></span>' +
            '<span class="metric-chip">📦 Cache: <b>' + (result.meta.cached ? 'HIT' : 'MISS') + '</b></span>' +
            '<span class="metric-chip">✅ Schema Valid: <b>' + (result.meta.validation?.valid ? 'YES' : 'NO') + '</b></span>';
        }
        renderDataTable(result.data);
      } catch (err) {
        document.getElementById('jsonOutputBox').textContent = 'Error: ' + err.message;
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = '▶ Run Blueprint';
      }
    }

    function renderDataTable(data) {
      const container = document.getElementById('outputViewTable');
      const rows = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : []);
      if (rows.length === 0 || typeof rows[0] !== 'object' || rows[0] === null) {
        container.innerHTML = '<div style="color:var(--text-muted);padding:1rem;">No tabular array/object data to display.</div>';
        return;
      }
      const cols = Object.keys(rows[0]);
      container.innerHTML = '<table class="data-table"><thead><tr>' +
        cols.map(c => '<th>' + c + '</th>').join('') +
        '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + cols.map(c => {
          const val = r[c];
          const text = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '');
          return '<td>' + text.replace(/</g, '&lt;') + '</td>';
        }).join('') + '</tr>').join('') +
        '</tbody></table>';
    }

    function switchOutputView(view) {
      ['json', 'table', 'snippets', 'yaml'].forEach(v => {
        document.getElementById('outputView' + v.charAt(0).toUpperCase() + v.slice(1)).style.display = v === view ? 'block' : 'none';
        document.getElementById('outTab' + v.charAt(0).toUpperCase() + v.slice(1)).classList.toggle('active', v === view);
      });
    }

    function switchMainTab(tabId, btn) {
      document.querySelectorAll('.tab-view').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('header .tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById('tab-' + tabId).classList.add('active');
      btn.classList.add('active');
      if (tabId === 'vault') loadVaultProfiles();
    }

    async function runUrlInspector() {
      const url = document.getElementById('inspectUrlInput').value.trim();
      if (!url) return;
      const btn = document.getElementById('inspectBtn');
      btn.disabled = true;
      btn.textContent = '⏳ Inspecting URL...';
      try {
        const res = await fetch('/api/v1/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const report = await res.json();
        document.getElementById('inspectorResultCard').style.display = 'block';
        document.getElementById('inspectorSummaryBadges').innerHTML =
          '<span class="metric-chip">Recommended Tier: <b>' + (report.recommendedTier || '').toUpperCase() + '</b></span>' +
          '<span class="metric-chip">Strategy: <b>' + (report.recommendedStrategy || '') + '</b></span>' +
          '<span class="metric-chip">Repeatable DOM Lists: <b>' + (report.repeatableDomCandidates?.length || 0) + '</b></span>' +
          '<span class="metric-chip">JSON-LD Blocks: <b>' + (report.jsonLdCount || 0) + '</b></span>';
        document.getElementById('inspectorYamlEditor').value = report.generatedYaml || JSON.stringify(report, null, 2);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔍 Inspect & Generate Blueprint';
      }
    }

    async function saveInspectedBlueprint() {
      const yaml = document.getElementById('inspectorYamlEditor').value;
      const res = await fetch('/api/v1/blueprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml })
      });
      const data = await res.json();
      if (data.blueprint) {
        await loadBlueprints();
        selectBlueprint(data.blueprint.id);
        document.querySelector('header .tab-btn').click();
      } else {
        alert('Error: ' + (data.error || 'Failed to save'));
      }
    }

    function loadSampleHar() {
      const sample = {
        log: {
          entries: [
            {
              request: {
                method: "GET",
                url: "https://hn.algolia.com/api/v1/search?query=playwright&tags=story",
                headers: [{ name: "Accept", value: "application/json" }]
              },
              response: {
                status: 200,
                content: {
                  mimeType: "application/json",
                  text: JSON.stringify({
                    hits: [
                      { objectID: "101", title: "Fast Web APIs with OpenAct", points: 250, author: "alice" }
                    ]
                  })
                }
              }
            }
          ]
        }
      };
      document.getElementById('harJsonInput').value = JSON.stringify(sample, null, 2);
    }

    async function compileHarInput() {
      const raw = document.getElementById('harJsonInput').value.trim();
      if (!raw) return;
      const urlFilter = document.getElementById('harFilterInput').value.trim();
      const res = await fetch('/api/v1/compile-har', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ har: JSON.parse(raw), urlFilter: urlFilter || undefined })
      });
      const out = await res.json();
      document.getElementById('harResultCard').style.display = 'block';
      document.getElementById('harSummaryInfo').innerHTML =
        '<span class="metric-chip">Candidates Found: <b>' + (out.candidates?.length || 0) + '</b></span>' +
        '<span class="metric-chip">Selected Score: <b>' + (out.selectedCandidate?.score || 0) + '</b></span>' +
        '<span class="metric-chip">Root Path: <b>' + (out.selectedCandidate?.rootPath || '$') + '</b></span>';
      document.getElementById('harYamlEditor').value = out.generatedYaml || JSON.stringify(out, null, 2);
    }

    async function saveHarBlueprint() {
      const yaml = document.getElementById('harYamlEditor').value;
      const res = await fetch('/api/v1/blueprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml })
      });
      const data = await res.json();
      if (data.blueprint) {
        await loadBlueprints();
        selectBlueprint(data.blueprint.id);
        document.querySelector('header .tab-btn').click();
      }
    }

    async function loadVaultProfiles() {
      const res = await fetch('/api/v1/vault/profiles');
      const data = await res.json();
      const list = data.profiles || [];
      const el = document.getElementById('vaultProfilesList');
      if (list.length === 0) {
        el.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">No profiles stored yet.</div>';
        return;
      }
      el.innerHTML = '<table class="data-table"><thead><tr><th>Profile</th><th>Domain</th><th>Headers</th><th>Secrets</th><th>Updated</th></tr></thead><tbody>' +
        list.map(p => '<tr><td><b>' + p.name + '</b></td><td>' + (p.domain || '-') + '</td><td>' + p.headerKeys.join(', ') + '</td><td>' + p.secretKeys.join(', ') + '</td><td>' + p.updatedAt + '</td></tr>').join('') +
        '</tbody></table>';
    }

    async function saveVaultProfile() {
      const name = document.getElementById('vaultName').value.trim();
      if (!name) return alert('Profile name is required');
      const domain = document.getElementById('vaultDomain').value.trim();
      const headers = JSON.parse(document.getElementById('vaultHeaders').value || '{}');
      const secrets = JSON.parse(document.getElementById('vaultSecrets').value || '{}');
      await fetch('/api/v1/vault/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, domain: domain || undefined, headers, secrets })
      });
      loadVaultProfiles();
    }

    loadBlueprints();
  </script>
</body>
</html>`;
}
