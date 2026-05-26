# Rollup Example

A minimal example demonstrating how to use `rollup-plugin-dts` with Rollup.

## Project Structure

```
examples/rollup/
├── package.json
├── tsconfig.json
├── rollup.config.mts
└── src/
    └── index.ts        # Source file with TypeScript types
```

## Usage

```bash
# Install dependencies
cd examples/rollup
pnpm install

# Build
pnpm run build
```

## Output

After building, you will get:

- `dist/index.js` — Bundled JavaScript
- `dist/index.d.ts` — Bundled TypeScript declarations
