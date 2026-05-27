# AGENTS.md

## Project Overview

`@baicie/plugin-dts` (a fork of `rollup-plugin-dts`) is a dual-bundler plugin that bundles `.d.ts` TypeScript declaration files into a single file. It supports both **Rollup** (via `dts()`) and **Rolldown** (via `rolldownDts()`).

- **Package**: `@baicie/plugin-dts`
- **Version**: 0.0.0 (pre-release)
- **License**: LGPL-3.0-only
- **Node**: >= 20
- **Package Manager**: pnpm

## Architecture

### Dual-Entry Design

The plugin uses a shared core factory with two thin entry points:

- **`src/index.ts`** — Rollup entry, exports `dts()` and `default`
- **`src/rolldown.ts`** — Rolldown entry, exports `rolldownDts()`
- **`src/shared-plugin.ts`** — The shared plugin factory (`createDtsPlugin()`) that contains all the logic

### Core Modules

| File                                      | Purpose                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/index.ts`                            | Rollup plugin entry (`dts()`)                                                                |
| `src/rolldown.ts`                         | Rolldown plugin entry (`rolldownDts()`)                                                      |
| `src/shared-plugin.ts`                    | Plugin factory — options, resolveId, transform hooks                                         |
| `src/options.ts`                          | Plugin options interface (`Options`, `ResolvedOptions`)                                      |
| `src/program.ts`                          | TypeScript Program creation                                                                  |
| `src/helpers.ts`                          | Utility functions (`DTS_EXTENSIONS`, `JSON_EXTENSIONS`, `getDeclarationId`, `trimExtension`) |
| `src/core/context.ts`                     | Plugin context interface                                                                     |
| `src/core/module.ts`                      | Module reading and program lookup                                                            |
| `src/core/resolve.ts`                     | Import resolution via TypeScript's `ts.resolveModuleName()`                                  |
| `src/core/constants.ts`                   | Extension regex patterns (`TS_EXTENSIONS`)                                                   |
| `src/transform/index.ts`                  | Main transform orchestrator                                                                  |
| `src/transform/Transformer.ts`            | TS AST to ESTree converter (the "virtual AST" trick)                                         |
| `src/transform/DeclarationScope.ts`       | Scope management for identifiers                                                             |
| `src/transform/NamespaceFixer.ts`         | Converts namespace exports to proper TS syntax                                               |
| `src/transform/ModuleDeclarationFixer.ts` | Resolves `declare module` paths                                                              |
| `src/transform/TypeOnlyFixer.ts`          | Separates type-only and value imports/exports                                                |
| `src/transform/preprocess.ts`             | Code preprocessing (removes export modifiers, reorders declarations)                         |
| `src/transform/astHelpers.ts`             | AST utilities                                                                                |
| `src/transform/languageService.ts`        | TypeScript language service integration                                                      |
| `src/transform/sourcemap.ts`              | Sourcemap handling                                                                           |
| `src/transform/errors.ts`                 | Error classes                                                                                |

### The "Virtual AST" Trick

The plugin abuses Rollup's bundling mechanism by converting TypeScript declarations into a **virtual AST** — creating bogus `FunctionDeclaration` nodes annotated with correct `start`/`end` positions. This directs Rollup to keep/remove parts of the original `.d.ts` text. See `docs/how-it-works.md` for a detailed explanation.

Key techniques:

- Bogus `FunctionDeclaration` nodes with correct positions for Rollup to tree-shake
- Side-effect calls (`_()`) to prevent removal
- Function parameter defaults to create references
- Arrow functions with dead code for nested removal

### Sourcemap Handling

The plugin implements **sparse-anchor hydration** to enable Go-to-Definition support:

- Rollup's bundle map is sparse (only declaration boundaries)
- TypeScript's declaration maps have per-token granularity
- We use Rollup's sparse segments as "anchors" to find source lines, then copy detailed segments from input maps
- Libraries: `@jridgewell/remapping`, `@jridgewell/sourcemap-codec`, `convert-source-map`

See `docs/how-it-works.md` for the full sourcemap design.

## Development

### Scripts

```bash
pnpm run build     # tsc -p tsconfig.build.json && rollup -c
pnpm run test      # c8 node temp/tests/index.js  (builds first)
pnpm run release   # tsx scripts/release.ts
pnpm run ci-publish # tsx scripts/publish.ts
```

### Build Pipeline

1. `tsc -p tsconfig.build.json` — compiles TypeScript to `dist/`
2. `rollup -c` — bundles the plugin itself

### Package Exports

```json
{
  ".": {
    "types": "./dist/rollup-plugin-dts.d.mts",
    "import": "./dist/rollup-plugin-dts.mjs",
    "require": "./dist/rollup-plugin-dts.cjs"
  },
  "./rolldown": {
    "types": "./dist/rolldown.d.mts",
    "import": "./dist/rolldown.mjs",
    "require": "./dist/rolldown.cjs"
  }
}
```

## Testing

### Test Structure

Tests live in `tests/`:

- `testcases/` — ~50+ test cases with `index.d.ts` inputs and `expected.d.ts` outputs
- `sourcemap-fixtures/` — sourcemap tests
- `index.ts` — test runner using a custom `Harness` class
- `utils.ts` — test utilities

### Running Tests

```bash
pnpm run test  # runs build first, then test
```

### Adding a New Test Case

1. Create a directory under `tests/testcases/`
2. Add `index.d.ts` (input) and `expected.d.ts` (expected output)
3. Run tests — the harness will automatically pick it up

## Rolldown Compatibility

The plugin uses a compatibility layer (`CreateDtsPluginOptions.bundler`) to handle differences between Rollup and Rolldown:

- **Rolldown mode**: Remembers transformed `.d.ts` code in a map, retrieves it in `renderChunk` since Rolldown's chunk modules don't expose raw code
- **Rollup mode**: Uses standard `renderChunk` with `inputCode`

### Key Differences Handled

- Rolldown defaults to JS parsing; the plugin intercepts `.d.ts` in `transform` before core parser sees it
- `resolveId` returns conservative results for Rolldown
- Path normalization (`\` → `/`) for cross-platform compatibility

## Important Conventions

- **No other resolution plugins**: The plugin uses TypeScript's own module resolution. Using `node-resolve` or similar alongside this plugin is not recommended and may cause errors.
- **Works best with `.d.ts`**: While `.ts` and `.js` inputs are supported via TypeScript emit, the plugin is optimized for `.d.ts` files generated by the TypeScript compiler.
- **External libraries are auto-externalized**: All `node_modules` are excluded from bundling by default. Use `respectExternal: true` or `includeExternal: [...]` to override.
- **Prettier**: The project uses Prettier with `printWidth: 120` and `trailingComma: "all"`.
- **Git hooks**: `commit-msg` hook runs `tsx scripts/verify-commit.ts` to validate conventional commits.
- **Do not `@ts-ignore` without `@ts-expect-error`**: When suppressing TypeScript errors, prefer `@ts-expect-error` for intentional suppressions.

## Sourcemap Option

When `dts({ sourcemap: true })` is set:

- **`.d.ts` files**: Loads external `.d.ts.map` files from disk
- **`.ts` files**: Captures TypeScript's in-memory declaration map during `program.emit()`
- Requires `output.sourcemap: true` in the Rollup/Rolldown config
- `sourcesContent` is stripped from output maps (tsserver rejects sourcemaps containing it)
- TypeScript's `sourceRoot` can be a URL — detected via `://` pattern and resolved using the `URL` constructor

## Documentation

- `README.md` — Usage, options, rationale
- `docs/how-it-works.md` — Detailed architecture explanation (virtual AST, sourcemaps)
- `docs/how-it-works.zh-CN.md` — Chinese translation
- `docs/design.md` — Rolldown compatibility design notes

## Peer Dependencies

The plugin declares both `rollup` and `rolldown` as optional peer dependencies, allowing users to install either bundler without forcing both.
