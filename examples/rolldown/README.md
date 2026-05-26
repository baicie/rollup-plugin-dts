# Rolldown Example

A minimal example demonstrating how to use `rollup-plugin-dts` with Rolldown.

## Project Structure

```
examples/rolldown/
├── package.json
├── tsconfig.json
├── rolldown.config.mts
└── src/
    └── index.ts        # Source file with TypeScript types
```

## Usage

```bash
# Install dependencies
cd examples/rolldown
pnpm install

# Build
pnpm run build
```

## Output

After building, you will get:

- `dist/index.js` — Bundled JavaScript
- `dist/index.d.ts` — Bundled TypeScript declarations
