# LLM Connections & Setup Wizard — Design

- **Date:** 2026-10-17
- **Status:** Approved (brainstorming), pending implementation plan
- **Replaces:** the flat `LlmConfigPanel` (single OpenAI-compatible endpoint + key + model) from Bloque 5 (#6)
- **Framework impact:** `AGENTS.md` §2.6 must be updated (see §10)

## 1. Goal

Replace the flat LLM settings form with a guided, foolproof setup wizard that supports several saved connections, validates everything end-to-end before persisting, and lets the user switch connection + model from a selector in the bottom-right corner of the app.

## 2. Decisions and constraints

| Decision | Rationale |
|---|---|
| **No direct OAuth with any provider.** | Anthropic forbids third-party use of Free/Pro/Max OAuth tokens (docs, Feb 2026) and enforces it server-side; tokens only work when impersonating Claude Code, which risks account suspension. Kimi and z.ai offer no official third-party OAuth (they issue plan API keys). Gemini OAuth requires the user to own a GCP project + OAuth client — the opposite of foolproof. |
| **Subscriptions are used through official CLIs** (`claude -p`, `gemini -p`). | Local CLI use with the user's own subscription is permitted; no impersonation. Small residual grey zone (a desktop app invoking the CLI) accepted by the user. |
| **Kimi and z.ai via API keys** (coding plan or pay-as-you-go). | Both issue keys for third-party tools; the user is fine with this. |
| **Several saved connections; selector picks connection + model.** | E.g. "Home · Claude Code / opus" vs "Office · gpt-4.1". |
| **Azure AI Foundry with Entra ID via `az login`.** | User's work setup. MarkDaun obtains and refreshes the token itself (replaces the user's manual refresh scripts). Foundry hosts both OpenAI deployments and Anthropic models. |
| **Generic OpenAI-compatible proxy is first class** (LiteLLM, corporate LLM proxy). | User's office is moving to a token-authenticated, OpenAI-compatible proxy. Needs custom header, extra headers and custom root CA (TLS interception). |
| **Nothing is persisted until validation passes.** | Explicit user requirement. |
| **All logic and secrets live in Rust;** secrets only in the OS keyring. | `AGENTS.md` §2.5/§2.6. The webview only sees a secret once, when pasted. |
| Embeddings stay local (`fastembed`). | Unchanged; this design covers chat only. |

## 3. Data model

### 3.1 Connection

```rust
struct Connection {
    id: String,                       // uuid v4
    name: String,                     // shown in the selector, e.g. "Office"
    preset_id: Option<String>,        // which preset it came from (icon + help)
    engine: Engine,
    base_url: Option<String>,         // None for CLI engines
    auth: AuthSource,
    auth_header: AuthHeader,          // default Bearer
    extra_headers: Vec<(String, String)>,
    ca_cert_path: Option<String>,     // extra root CA (PEM), for TLS-intercepting proxies
    azure_api_version: Option<String>,// only for Azure OpenAI deployments
    models: Vec<String>,              // models validated/selected in the wizard (>= 1)
}

enum Engine { OpenAiCompat, AnthropicMessages, CliClaude, CliGemini }
enum AuthSource { None, ApiKey /* keyring entry keyed by connection id */, AzureCli { scope: String } }
enum AuthHeader { Bearer, ApiKey /* "api-key:" */, XApiKey /* "x-api-key:" */ }
```

- **Active selection:** `(connection_id, model)`, persisted in `config.db`.
- **Storage:** connections in `config.db` (`llm_connections` table, one JSON row per connection). Secrets only in keyring: service `markdaun`, user `llm-connection:<id>`.
- **Migration:** on first run, an existing `llm_endpoint_url` / `llm_model` / `llm-api-key` config becomes one `OpenAiCompat` connection named "Migrated", set as active. Old keys are removed after a successful migration.

### 3.2 Presets (frontend data only, `src/lib/llm/presets.ts`)

| Preset | Route | Engine | Base URL | Auth |
|---|---|---|---|---|
| Claude Code | Subscription | `CliClaude` | — | none |
| Gemini CLI | Subscription | `CliGemini` | — | none |
| Anthropic API | API key | `AnthropicMessages` | `https://api.anthropic.com` | key, `x-api-key` |
| Gemini API | API key | `OpenAiCompat` | `https://generativelanguage.googleapis.com/v1beta/openai` | key |
| Kimi Coding Plan | API key | `OpenAiCompat` | `https://api.kimi.com/coding/v1` | key |
| Kimi (pay-as-you-go) | API key | `OpenAiCompat` | `https://api.moonshot.ai/v1` | key |
| z.ai Coding Plan | API key | `OpenAiCompat` | `https://api.z.ai/api/coding/paas/v4` | key |
| z.ai (pay-as-you-go) | API key | `OpenAiCompat` | `https://api.z.ai/api/paas/v4` | key |
| Azure Foundry — OpenAI | Company | `OpenAiCompat` (Azure variant) | `https://<resource>.openai.azure.com` | `AzureCli` or key (`api-key`) |
| Azure Foundry — Anthropic | Company | `AnthropicMessages` | `https://<resource>.services.ai.azure.com/anthropic` | `AzureCli` or key |
| LiteLLM / OpenAI-compatible proxy | Company | `OpenAiCompat` | user-provided | token, none, or `AzureCli` |

Each preset also carries: link to create the key, suggested models (fallback when `/models` is unavailable), 1–2 lines of help text, and an icon. Endpoint URLs must be re-verified against provider docs during implementation.

## 4. Wizard (UX)

Full-screen modal, step indicator, built only with `design/` tokens and components.

1. **Route:** three large cards — *Use my subscription* · *I have an API key* · *My company endpoint / proxy*.
2. **Provider:** preset cards for that route.
3. **Credentials:**
   - CLI: no input. Shows detection status (installed / logged in) with copyable instructions (e.g. "Run `claude` and log in") and a *Check again* button.
   - API key: *Open page to create the key* button, masked input, prefilled editable URL where relevant.
   - Company: URL, auth type (token / `az login` / none), collapsed *Advanced* section (auth header, extra headers, root CA file).
4. **Validation:** live checklist — reach endpoint / CLI installed → credential valid / CLI logged in → models listed (or suggested) → real test completion against the chosen model. Stops at the first failure with a human message and a concrete action.
5. **Models & name:** pick which models appear in the selector (at least one, and every picked model is test-completed or listed by the endpoint), name the connection, *Save*.

Rules:
- *Save* is enabled only after step 4 passes; the keyring write happens only on save.
- Editing a connection re-runs validation before saving.
- Settings → *AI connections*: list with edit / duplicate / delete. `LlmConfigPanel` is removed.

## 5. Model switcher

- Fixed pill, **bottom-right** of the main window: `<connection name> · <model>`.
- Click → popover with connections grouped, their models as options, plus *+ Add connection* and *Manage*.
- No connections → pill reads *Set up AI* and opens the wizard.
- Selection persists via `llm_set_active`.

## 6. Backend architecture (Rust)

```
src-tauri/src/llm/
├── connection.rs   types + serde
├── store.rs        CRUD in config.db, active selection, migration
├── auth.rs         resolve(AuthSource) -> credential; az token cache
├── http.rs         per-connection reqwest client: auth header, extra headers, extra root CA
├── validate.rs     step pipeline, emits progress events, never persists
└── engines/
    ├── mod.rs      trait ChatEngine { list_models, chat }
    ├── openai.rs   GET /models, POST /chat/completions (+ Azure variant: deployments path, api-version)
    ├── anthropic.rs GET /v1/models, POST /v1/messages (anthropic-version header)
    └── cli.rs      detect, fixed model list, chat via `claude -p` / `gemini -p`
```

### 6.1 Tauri commands

| Command | Purpose |
|---|---|
| `llm_validate(draft, secret?)` | Validate an unsaved connection; emits `llm-validate-progress` events per step; returns available models. Persists nothing. |
| `llm_save_connection(draft, secret?, validationToken)` | `llm_validate` returns a `validationToken` bound to a hash of the draft + secret; save rejects a missing or mismatched token, then writes connection + keyring secret. |
| `llm_list_connections()` | Connections without secrets. |
| `llm_delete_connection(id)` | Removes row + keyring entry; clears active selection if it pointed there. |
| `llm_set_active(connectionId, model)` / `llm_get_active()` | Selector state. |
| `brain_query(...)` | Existing command; now resolves the active connection + model and dispatches to its engine. |

`brain_configure` / `brain_get_config` are removed after migration.

### 6.2 CLI bridge

- Resolve binaries through the login shell (`zsh -lc 'command -v claude'` on macOS; `where` on Windows) because Dock-launched apps do not inherit the user's `PATH`.
- Run in an empty temporary directory, non-interactive, single turn, no tools / no permissions, JSON output; RAG context goes into the prompt.
- **Remove `ANTHROPIC_API_KEY` (and Gemini API key env vars) from the child environment** so the CLI uses the subscription login.
- Timeout (default 120 s); tolerant JSON parsing; non-zero exit mapped to typed errors (not logged in vs. other).
- Model list for CLI engines is a fixed list per CLI (e.g. `opus`, `sonnet`, `haiku` aliases for Claude Code), confirmed by the test completion.
- Exact CLI flags are verified against the installed CLI versions during implementation.

### 6.3 Azure CLI auth

- `az account get-access-token --scope <scope> --output json`; token cached in memory and refreshed when < 5 min to expiry.
- Default scopes: `https://cognitiveservices.azure.com/.default` (preset-overridable).
- "Please run az login" output maps to `CliNotLoggedIn` with action "Run `az login`".

### 6.4 Errors

```rust
enum LlmError { Unreachable, Unauthorized, TlsUntrusted, ModelNotFound, CliMissing, CliNotLoggedIn, Timeout, BadResponse(String) }
```

Serialized as `{ kind, detail }`; the frontend maps each `kind` to a human message + action (e.g. `TlsUntrusted` → "Your company may be intercepting TLS. Add its root certificate under Advanced.").

## 7. Frontend

- `src/lib/llm/presets.ts` — preset catalog.
- `src/lib/tauri.ts` — typed wrappers for the new commands (camelCase args; guarded by `invokeArgs.test.ts`).
- `src/store/llmStore.ts` — connections, active selection, wizard state.
- `src/components/LlmWizard/` — `LlmWizard`, `ChooseRoute`, `ChooseProvider`, `Credentials`, `Validation`, `ModelsAndName`.
- `src/components/ModelSwitcher/` — pill + popover.
- Settings view: *AI connections* section replaces `LlmConfigPanel`.

## 8. Testing (strict TDD, ≥ 80 % line coverage)

**Rust**
- Each engine against a local fake HTTP server: 200, 401, 404 model, timeout, malformed body; Azure path/api-version; custom auth header and extra headers.
- TLS: a self-signed server fails with `TlsUntrusted` without CA and succeeds with `ca_cert_path`.
- CLI engine with a fake executable script (success JSON, not-logged-in, crash, timeout); assert `ANTHROPIC_API_KEY` is not passed through.
- Azure token cache with an injectable clock and fake `az` script.
- Store: CRUD, active selection, delete clears active, migration from legacy config.
- Validation pipeline: emits steps in order, stops at first failure, never persists.

**Frontend**
- Each wizard step; *Save* disabled until validation passes; error kind → message mapping.
- Model switcher: renders active selection, switching persists, empty state opens wizard.
- Presets: every preset has engine, auth, help text; URL presets are valid URLs.

## 9. Out of scope

- Streaming responses (current chat is non-streaming; later iteration).
- Direct OAuth with any provider.
- Embedding configuration (stays local).
- Proxy configuration at the OS/HTTP-proxy level (only custom endpoint, headers and CA).

## 10. Follow-ups

- Update `AGENTS.md` §2.6 to describe connections, engines, CLI bridge and Azure CLI auth instead of a single OpenAI-compatible endpoint.
