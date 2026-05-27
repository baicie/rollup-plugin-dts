import type { RollupWatchOptions } from 'rollup'
import dts from './temp/src/index.js'

const external = [
  'node:module',
  'node:path',
  'node:fs',
  'node:fs/promises',
  'typescript',
  'rollup',
  '@babel/code-frame',
  'magic-string',
  '@jridgewell/remapping',
  '@jridgewell/sourcemap-codec',
  'convert-source-map',
]

const config: Array<RollupWatchOptions> = [
  {
    input: './temp/src/index.js',
    output: [
      { file: './dist/rollup-plugin-dts.mjs', format: 'es' },
      {
        file: './dist/rollup-plugin-dts.cjs',
        format: 'commonjs',
        exports: 'named',
      },
    ],
    external,
  },
  {
    input: './temp/src/index.d.ts',
    output: [
      { file: './dist/rollup-plugin-dts.d.mts' },
      { file: './dist/rollup-plugin-dts.d.cts' },
    ],
    plugins: [dts()],
  },
  {
    input: './temp/src/rolldown.js',
    output: [
      { file: './dist/rolldown.mjs', format: 'es' },
      { file: './dist/rolldown.cjs', format: 'commonjs', exports: 'named' },
    ],
    external,
  },
  {
    input: './temp/src/rolldown.d.ts',
    output: [
      { file: './dist/rolldown.d.mts' },
      { file: './dist/rolldown.d.cts' },
    ],
    plugins: [dts()],
  },
]

export default config
