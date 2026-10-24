# Image Rendering (GIF, JPEG/JPG) Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Enable visual rendering of GIF, JPEG/JPG, and standard raster images inside MarkDaun notes by enabling Tauri 2 asset protocol, fixing path resolution (handling leading `//`, spaces, `%20`, relative subpaths), and saving clean relative paths for vault portability.

**Architecture:** Tauri 2's `assetProtocol` is enabled to allow WKWebView / WebView2 to securely stream local vault files via `convertFileSrc()`. Frontend `resolveImageSrc` and `processImagesOnLoad` strip redundant slashes, decode URL entities, and resolve relative/absolute paths. On note save, `processImagesOnSave` converts internal asset URLs back to relative paths against the note's directory.

**Tech Stack:** Tauri 2 (Rust), React 18, TipTap 2.x, TypeScript, Vitest, `@tauri-apps/api/core`.

---

### Task 1: Enable Asset Protocol in Tauri 2 Configuration

**Files:**
- Modify: `src-tauri/tauri.conf.json:34-40`

**Step 1: Check existing security configuration**

Review `src-tauri/tauri.conf.json`:
```json
    "security": {
      "csp": null
    }
```

**Step 2: Update `tauri.conf.json` with assetProtocol configuration**

Configure `assetProtocol` with `enable: true` and scopes:
```json
    "security": {
      "assetProtocol": {
        "enable": true,
        "scope": [
          "$HOME/**",
          "$DOCUMENT/**",
          "$DESKTOP/**",
          "$DOWNLOAD/**"
        ]
      },
      "csp": null
    }
```

**Step 3: Verify Rust backend compiles and tests pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 605+ passed, 0 failures.

**Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(tauri): enable assetProtocol with user directory scopes"
```

---

### Task 2: Robust Image Path Resolution on Load (`resolveImageSrc` & `processImagesOnLoad`)

**Files:**
- Modify: `src/store/editorStore.ts:50-75`
- Test: `src/store/editorStore.resolveImageSrc.test.ts`

**Step 1: Write failing tests for path resolution**

In `src/store/editorStore.resolveImageSrc.test.ts`, add tests:
- Normalizing `//Users/carlosdiez/...` to absolute path without stripping `/Users`.
- Resolving relative paths with parent traversals `../../media/recipes/0001.jpg`.
- Handling paths with encoded spaces `%20` or actual spaces and UTF-8 characters (`gelée`).
- Supporting `.gif`, `.jpg`, `.jpeg`, `.png`, `.webp`, `.svg`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/editorStore.resolveImageSrc.test.ts`
Expected: FAIL on `//Users/...` (currently strips `/Users`).

**Step 3: Implement minimal code in `src/store/editorStore.ts`**

Update `resolveImageSrc`:
- Ignore remote URLs (`https://`, `http://`, `data:`, `tauri://`, `asset://`).
- Strip leading double slashes `src.replace(/^\/\/+/, '/')`.
- Decode URI component in path.
- If path starts with `/` (Unix) or `^[a-zA-Z]:[/\\]` (Windows), it is already absolute: call `convertAssetSrc(absPath)`.
- If path is relative, resolve relative to `noteDir` using standard POSIX/path normalization.
- Update `processImagesOnLoad` to apply this resolution consistently.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/editorStore.resolveImageSrc.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/store/editorStore.ts src/store/editorStore.resolveImageSrc.test.ts
git commit -m "fix(editor): resolve absolute and relative image paths with leading slashes"
```

---

### Task 3: Portability on Save — Converting Image Paths to Relative in `processImagesOnSave`

**Files:**
- Modify: `src/store/editorStore.ts:65-95`
- Test: `src/store/editorStore.resolveImageSrc.test.ts`

**Step 1: Write failing tests for `processImagesOnSave`**

In `src/store/editorStore.resolveImageSrc.test.ts`:
- Note at `/vault/recipes/1983/0001.md` with image at `asset://localhost/vault/media/recipes/0001.jpg` (or absolute `/vault/media/recipes/0001.jpg`).
- Assert it saves as `../../media/recipes/0001.jpg` in Markdown.
- Images with `//Users/...` within the vault are also converted to relative paths.
- Remote URLs (`https://...`) are preserved unchanged.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/editorStore.resolveImageSrc.test.ts`
Expected: FAIL on parent traversal paths (currently only handles child subpaths starting with `notePrefix`).

**Step 3: Implement `relativePosixPath(fromDir, toPath)` in `src/store/editorStore.ts`**

Calculate the relative path between `noteDir` and image path using POSIX path logic:
- If both are inside `vaultPath` (or share root), compute `../` segments as needed.
- Replace `src` in `processImagesOnSave` with the clean relative path.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/editorStore.resolveImageSrc.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/store/editorStore.ts src/store/editorStore.resolveImageSrc.test.ts
git commit -m "feat(editor): convert image paths to relative paths on note save"
```

---

### Task 4: Input Rules and Drag-and-Drop Image Insertion

**Files:**
- Modify: `src/components/editor/extensions/MarkdownTyping.ts:7-25`
- Modify: `src/components/editor/EditorCanvas.tsx:120-135`
- Test: `src/components/editor/markdownTyping.test.tsx`

**Step 1: Write test for typing image markdown with spaces or paths**

In `src/components/editor/markdownTyping.test.tsx`:
- `![alt](media/recipes/0001_completo.jpg)` converts to image node with resolved src.
- `![alt](//Users/test/img.gif)` converts to image node.

**Step 2: Run test to verify**

Run: `npx vitest run src/components/editor/markdownTyping.test.tsx`

**Step 3: Update `IMAGE_RULE` in `MarkdownTyping.ts`**

Support paths with escaped spaces or URL characters:
`const IMAGE_RULE = /!\[([^[\]]*)\]\(([^)]+)\)$/;`

**Step 4: Run tests to verify**

Run: `npx vitest run src/components/editor/markdownTyping.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/editor/extensions/MarkdownTyping.ts src/components/editor/markdownTyping.test.tsx
git commit -m "fix(editor): support typing image paths with slashes and special characters"
```

---

### Task 5: Full Regression and Verification

**Files:**
- Run full suite: Vitest + Cargo tests

**Step 1: Run frontend tests**

Run: `npx vitest run`
Expected: 1140+ passing, 0 failing.

**Step 2: Run backend tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 605+ passing, 0 failing.

**Step 3: Verification on the user's specific recipe file**

Verify with unit test that `Personal/Recetas/elbulli-catalogo-md/recipes/1983-1993/0001-terrina-de-melon-con-gelee-de-oporto.md` correctly resolves `//Users/carlosdiez/Documents/markdaun/Personal/Recetas/elbulli-catalogo-md/media/recipes/0001_completo.jpg` to the existing file.
