可以做，但我不建议把目标定成“完全兼容 Rolldown + 保持 Rollup 行为 100% 一致”。更实际的目标是：

```txt
同一个 dts() 插件：
- 在 Rollup 里保持现状
- 在 Rolldown 里能稳定处理 .d.ts / .ts / .json
- 避免 Rolldown core 直接解析 .d.ts
- 避免依赖 Rollup 特有的 output 流程细节
```

你这个 fork 当前核心入口在 `src/index.ts`，插件导出 `dts/default`，内部已经有 `options`、`resolveId`、`transform`、`renderChunk`、`generateBundle` 等 hook，并且 DTS 解析、TS emit、模块解析主要都在这个插件里完成。

---

## 1. 问题本质

`rollup-plugin-dts` 本身是给 Rollup 设计的。它 README 里也明确说它是用来 roll-up `.d.ts` 文件的，并且会通过 TypeScript compiler 做自己的 import resolution，不推荐和其他 resolve 插件混用；项目也处于 maintenance mode。([GitHub][1])

Rolldown 虽然插件接口“almost fully compatible with Rollup”，但不是完全复刻 Rollup 内部行为。官方文档也只说“almost fully compatible”，不是 100%。([Rolldown][2])

所以兼容重点不是“把类型改成 Rolldown Plugin 类型”这么简单，而是要处理这些差异：

```txt
1. Rolldown 默认还是 JS bundler，不能让 .d.ts 落到 core parser
2. resolveId 返回值在 Rolldown 中要更保守
3. transform 返回值要保证是可被后续解析的 JS 形态，或者彻底阻断 core parse
4. renderChunk / generateBundle 不要依赖 Rollup 特有 chunk 结构
5. 多 output、watch、sourcemap 行为要单独兜底
```

---

## 2. 推荐总体方案

不要直接改原插件成“Rolldown only”，而是做成双入口：

```txt
rollup-plugin-dts
├─ dts()              // 原 Rollup 入口，保持兼容
├─ rolldownDts()      // 新 Rolldown 入口
└─ shared core        // 共用 TS 解析、声明生成、transform 逻辑
```

包导出建议：

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./rolldown": {
      "types": "./dist/rolldown.d.ts",
      "import": "./dist/rolldown.mjs",
      "require": "./dist/rolldown.cjs"
    }
  }
}
```

使用方式：

```ts
// Rollup
import { dts } from 'rollup-plugin-dts'

// Rolldown
import { rolldownDts } from 'rollup-plugin-dts/rolldown'
```

不建议让同一个 `dts()` 自动判断当前 bundler，因为 hook 行为差异隐藏起来后很难 debug。

---

## 3. 第一阶段：抽出通用 core

你当前 `src/index.ts` 里有这几个职责混在一起：

```txt
1. 创建 ctx
2. 创建 TypeScript Program
3. resolveId
4. transform .d.ts/.ts/.json
5. 转发 transformPlugin 的 output hooks
```

先抽一个核心文件。

### `src/core/context.ts`

```ts
import ts from 'typescript'
import type { ResolvedOptions } from '../options.js'

export interface DtsPluginContext {
  entries: string[]
  programs: ts.Program[]
  resolvedOptions: ResolvedOptions
}

export interface ResolvedModule {
  code: string
  source?: ts.SourceFile
  program?: ts.Program
}

export function createDtsContext(
  resolvedOptions: ResolvedOptions,
): DtsPluginContext {
  return {
    entries: [],
    programs: [],
    resolvedOptions,
  }
}
```

### `src/core/constants.ts`

```ts
export const TS_EXTENSIONS = /\.([cm]ts|[tj]sx?)$/
export const DTS_EXTENSIONS = /\.d\.[cm]?ts$|\.d\.ts$/
export const JSON_EXTENSIONS = /\.json$/
```

如果你项目里已经有 `DTS_EXTENSIONS`、`JSON_EXTENSIONS`，就继续复用 `helpers.ts` 里的，不重复定义。

---

## 4. 第二阶段：抽出模块读取逻辑

你当前 `getModule()` 逻辑已经比较完整，包括 `.d.ts`、外部库、按需 Program 创建。它现在写在 `index.ts` 里，建议抽到 `src/core/module.ts`。当前实现会在没有 Program 且是 `.d.ts` 时直接返回 `{ code }`，否则会从已有 TS Program 或文件系统里拿 source。

### `src/core/module.ts`

```ts
import * as path from 'node:path'
import ts from 'typescript'
import { createProgram } from '../program.js'
import { DTS_EXTENSIONS } from '../helpers.js'
import type { DtsPluginContext, ResolvedModule } from './context.js'

export function getModule(
  { entries, programs, resolvedOptions }: DtsPluginContext,
  fileName: string,
  code: string,
): ResolvedModule | null {
  const { compilerOptions, tsconfig } = resolvedOptions

  if (!programs.length && DTS_EXTENSIONS.test(fileName)) {
    return { code }
  }

  const isEntry = entries.includes(fileName)

  const existingProgram = programs.find(program => {
    if (isEntry) {
      return program.getRootFileNames().includes(fileName)
    }

    const sourceFile = program.getSourceFile(fileName)

    if (sourceFile && program.isSourceFileFromExternalLibrary(sourceFile)) {
      return false
    }

    return !!sourceFile
  })

  if (existingProgram) {
    const source = existingProgram.getSourceFile(fileName)!

    return {
      code: source.getFullText(),
      source,
      program: existingProgram,
    }
  }

  if (!ts.sys.fileExists(fileName)) {
    return null
  }

  if (programs.length > 0 && DTS_EXTENSIONS.test(fileName)) {
    const shouldBundleExternal =
      resolvedOptions.includeExternal.length > 0 ||
      resolvedOptions.respectExternal

    if (shouldBundleExternal) {
      return { code }
    }
  }

  const newProgram = createProgram(
    fileName,
    compilerOptions,
    tsconfig,
    resolvedOptions.sourcemap,
  )

  programs.push(newProgram)

  const source = newProgram.getSourceFile(fileName)!

  return {
    code: source.getFullText(),
    source,
    program: newProgram,
  }
}
```

---

## 5. 第三阶段：抽出 resolve 逻辑

你当前 `resolveId` 主要依赖 TypeScript 的 `ts.resolveModuleName()`，并对外部库做 external。

Rolldown 兼容时这里要保守一点：

```txt
- importer 为空时，记录 entry，但不要返回 undefined 造成行为不确定
- 返回 external 时，最好返回 { id: source, external: true }
- 返回本地文件时，全部 path.resolve
- Windows 路径统一 normalize
```

### `src/core/resolve.ts`

```ts
import * as path from 'node:path'
import ts from 'typescript'
import { getCompilerOptions } from '../program.js'
import type { DtsPluginContext } from './context.js'

export interface ResolveResult {
  id: string
  external?: boolean
}

export function normalizePath(id: string): string {
  return id.split('\\').join('/')
}

export function resolveDtsId(
  ctx: DtsPluginContext,
  source: string,
  importer?: string,
): ResolveResult | null {
  if (!importer) {
    const entry = path.resolve(source)
    ctx.entries.push(entry)

    // Rollup 原来这里可以 return undefined。
    // Rolldown 下建议显式返回 null，让 bundler 自己处理 entry。
    return null
  }

  importer = normalizePath(importer)

  let resolvedCompilerOptions = ctx.resolvedOptions.compilerOptions

  if (ctx.resolvedOptions.tsconfig) {
    const resolvedSource = source.startsWith('.')
      ? path.resolve(path.dirname(importer), source)
      : source

    resolvedCompilerOptions = getCompilerOptions(
      resolvedSource,
      ctx.resolvedOptions.compilerOptions,
      ctx.resolvedOptions.tsconfig,
      ctx.resolvedOptions.sourcemap,
    ).compilerOptions
  }

  const { resolvedModule } = ts.resolveModuleName(
    source,
    importer,
    {
      moduleResolution: ts.ModuleResolutionKind.Node10,
      ...resolvedCompilerOptions,
    },
    ts.sys,
  )

  if (!resolvedModule) {
    return null
  }

  const packageName = resolvedModule.packageId?.name

  if (
    resolvedModule.isExternalLibraryImport &&
    packageName &&
    ctx.resolvedOptions.includeExternal.includes(packageName)
  ) {
    return {
      id: path.resolve(resolvedModule.resolvedFileName),
    }
  }

  if (
    !ctx.resolvedOptions.respectExternal &&
    resolvedModule.isExternalLibraryImport
  ) {
    return {
      id: source,
      external: true,
    }
  }

  return {
    id: path.resolve(resolvedModule.resolvedFileName),
  }
}
```

---

## 6. 第四阶段：Rolldown 专用入口

关键点：**Rolldown 入口尽量不要依赖 Rollup 的 `PluginImpl` 类型，也不要把 `.d.ts` 交给 core parser。**

可以新增文件：

```txt
src/rolldown.ts
```

### `src/rolldown.ts`

```ts
import type { Plugin } from 'rolldown'
import { createDtsPlugin } from './shared-plugin.js'
import type { Options } from './options.js'

export type { Options }

export function rolldownDts(options: Options = {}): Plugin {
  return createDtsPlugin(options, {
    bundler: 'rolldown',
  }) as unknown as Plugin
}

export default rolldownDts
```

再把原来的 Rollup 入口也改成薄封装：

### `src/index.ts`

```ts
import type { PluginImpl } from 'rollup'
import { createDtsPlugin } from './shared-plugin.js'
import type { Options } from './options.js'

export type { Options }

const plugin: PluginImpl<Options> = (options = {}) => {
  return createDtsPlugin(options, {
    bundler: 'rollup',
  })
}

export { plugin as dts, plugin as default }
```

---

## 7. 第五阶段：共享插件工厂

这是核心。

### `src/shared-plugin.ts`

```ts
import * as path from 'node:path'
import type { Plugin } from 'rollup'
import { resolveDefaultOptions, type Options } from './options.js'
import { createPrograms } from './program.js'
import { transform } from './transform/index.js'
import { getDeclarationId, DTS_EXTENSIONS, JSON_EXTENSIONS } from './helpers.js'
import { createDtsContext } from './core/context.js'
import { getModule } from './core/module.js'
import { resolveDtsId } from './core/resolve.js'

const TS_EXTENSIONS = /\.([cm]ts|[tj]sx?)$/

export interface CreateDtsPluginOptions {
  bundler: 'rollup' | 'rolldown'
}

export function createDtsPlugin(
  options: Options = {},
  compat: CreateDtsPluginOptions,
): Plugin {
  const resolvedOptions = resolveDefaultOptions(options)
  const ctx = createDtsContext(resolvedOptions)
  const transformPlugin = transform(ctx.resolvedOptions.sourcemap)

  return {
    name: compat.bundler === 'rolldown' ? 'rolldown-dts' : 'dts',

    outputOptions: transformPlugin.outputOptions,
    renderChunk: transformPlugin.renderChunk,
    generateBundle: transformPlugin.generateBundle,

    options(inputOptions) {
      let { input = [] } = inputOptions

      if (!Array.isArray(input)) {
        input = typeof input === 'string' ? [input] : Object.values(input)
      } else if (input.length > 1) {
        inputOptions.input = {}

        for (const filename of input) {
          let name = path.basename(filename)

          if (!path.isAbsolute(filename)) {
            name = path.normalize(filename)
          }

          name = name
            .replace(/\.d\.[cm]?ts$/, '')
            .replace(/\.[cm]?[tj]sx?$/, '')

          inputOptions.input[name] = filename
        }
      }

      ctx.programs = createPrograms(
        Object.values(input),
        ctx.resolvedOptions.compilerOptions,
        ctx.resolvedOptions.tsconfig,
        ctx.resolvedOptions.sourcemap,
      )

      return transformPlugin.options.call(this, inputOptions)
    },

    resolveId(source, importer) {
      const resolved = resolveDtsId(ctx, source, importer)

      if (!resolved) {
        return null
      }

      return resolved
    },

    transform(code, id) {
      if (
        !TS_EXTENSIONS.test(id) &&
        !DTS_EXTENSIONS.test(id) &&
        !JSON_EXTENSIONS.test(id)
      ) {
        return null
      }

      const addWatchFiles = (module: ReturnType<typeof getModule>) => {
        if (!module?.program) return

        const sourceDirectory = path.dirname(id)

        module.program
          .getSourceFiles()
          .map(sourceFile => sourceFile.fileName)
          .filter(fileName => fileName.startsWith(sourceDirectory))
          .forEach(fileName => {
            this.addWatchFile(fileName)
          })
      }

      const handleDtsFile = () => {
        const module = getModule(ctx, id, code)

        if (!module) {
          return null
        }

        addWatchFiles(module)

        return transformPlugin.transform.call(this, module.code, id)
      }

      const treatTsAsDts = () => {
        const declarationId = getDeclarationId(id)
        const module = getModule(ctx, declarationId, code)

        if (!module) {
          return null
        }

        addWatchFiles(module)

        return transformPlugin.transform.call(this, module.code, declarationId)
      }

      const generateDts = () => {
        const module = getModule(ctx, id, code)

        if (!module?.source || !module.program) {
          return null
        }

        addWatchFiles(module)

        const declarationId = getDeclarationId(id)

        let declarationText: string | undefined
        let declarationMapText: string | undefined

        const { emitSkipped, diagnostics } = module.program.emit(
          module.source,
          (emitFileName, text) => {
            if (emitFileName.endsWith('.map')) {
              declarationMapText = text
            } else {
              declarationText = text
            }
          },
          undefined,
          true,
          undefined,
          // @ts-expect-error private TS API used by the original plugin
          true,
        )

        if (emitSkipped) {
          const errors = diagnostics.filter(diag => diag.category === 1)

          if (errors.length) {
            this.error('Failed to compile declaration files.')
          }
        }

        if (!declarationText) {
          return null
        }

        const cleanDeclarationText = declarationText.replace(
          /\n?\/\/# sourceMappingURL=[^\n]+/,
          '',
        )

        return transformPlugin.transform.call(
          this,
          cleanDeclarationText,
          declarationId,
          declarationMapText,
        )
      }

      if (DTS_EXTENSIONS.test(id)) {
        return handleDtsFile()
      }

      if (JSON_EXTENSIONS.test(id)) {
        return generateDts()
      }

      return treatTsAsDts() ?? generateDts()
    },
  }
}
```

这一步本质是把你现在 `src/index.ts` 里的核心代码迁移出来。当前源码中 `options()` 创建 TS programs，`transform()` 分三条路径处理 `.d.ts`、`.json`、`.ts`，`resolveId()` 通过 TypeScript resolver 解析依赖。

---

## 8. 关键兼容补丁：阻止 Rolldown 解析 `.d.ts`

有些情况下，Rolldown 仍可能在 transform 返回后尝试用 JS parser 解析 `.d.ts` 语法。你需要确保 `transform/index.ts` 的输出是“bundler 可解析”的模块，而不是原始 `.d.ts`。

`rollup-plugin-dts` 通常会把类型声明转换成 JS-ish AST 可接受结构，最后再在 `renderChunk` 还原/整理。如果你的 fork 当前已经这么做，可以保留；如果没有，要加一个 Rolldown 模式兜底。

最小兜底方案：把 `.d.ts` 模块包装成虚拟 JS 模块，并把原始 DTS 存在 map 里，后续 `renderChunk` 再恢复。

### `src/core/virtual.ts`

```ts
export const DTS_VIRTUAL_PREFIX = '\0dts:'

export function toDtsVirtualId(id: string): string {
  return DTS_VIRTUAL_PREFIX + id
}

export function isDtsVirtualId(id: string): boolean {
  return id.startsWith(DTS_VIRTUAL_PREFIX)
}

export function fromDtsVirtualId(id: string): string {
  return id.slice(DTS_VIRTUAL_PREFIX.length)
}
```

不过这属于大改。**我建议第一版先不加虚拟模块**，优先看你现有 `transform/index.ts` 是否已经能输出可解析代码。如果当前在 Rollup 能跑，通常说明它已经做了这件事。

---

## 9. 测试矩阵

新增 Rolldown 测试，不要直接复用 Rollup 快照。

### 安装依赖

```bash
pnpm add -D rolldown
```

### `tests/rolldown/basic.test.ts`

```ts
import { describe, expect, test } from 'vitest'
import { rolldown } from 'rolldown'
import { rolldownDts } from '../../src/rolldown'

describe('rolldownDts', () => {
  test('bundles simple dts entry', async () => {
    const bundle = await rolldown({
      input: 'tests/fixtures/basic/index.d.ts',
      plugins: [rolldownDts()],
    })

    const output = await bundle.generate({
      format: 'esm',
      file: 'dist/index.d.ts',
    })

    const code = output.output
      .filter(chunk => chunk.type === 'chunk')
      .map(chunk => chunk.code)
      .join('\n')

    expect(code).toContain('interface Foo')
    expect(code).toContain('export')
  })
})
```

### fixture

```ts
// tests/fixtures/basic/index.d.ts
export interface Foo {
  name: string
}
```

---

## 10. 高风险 case 必测

至少加这些：

```txt
1. import type
2. export type
3. export { Foo } from './foo'
4. export * from './foo'
5. declare global
6. declare namespace
7. default export type-ish declaration
8. node_modules external
9. includeExternal
10. paths alias
11. .json with resolveJsonModule
12. .ts input emit d.ts
13. Windows path
14. 多 entry
```

例如：

```ts
// tests/fixtures/reexport/index.d.ts
export type { Foo } from './foo'
export { Bar } from './bar'
export * from './baz'
```

```ts
// tests/fixtures/global/index.d.ts
declare global {
  interface Window {
    __ZEUS__: boolean
  }
}

export {}
```

---

## 11. package.json 草案

```json
{
  "name": "rollup-plugin-dts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./rolldown": {
      "types": "./dist/rolldown.d.ts",
      "import": "./dist/rolldown.mjs",
      "require": "./dist/rolldown.cjs"
    }
  },
  "peerDependencies": {
    "rollup": "^3.29.0 || ^4.0.0",
    "typescript": "^5.0.0"
  },
  "peerDependenciesMeta": {
    "rollup": {
      "optional": true
    }
  },
  "devDependencies": {
    "rolldown": "^1.0.0"
  },
  "keywords": ["rollup-plugin", "rolldown-plugin", "dts", "typescript"]
}
```

注意：不要把 `rolldown` 放进 peerDependency 也行，除非你要让 `import type { Plugin } from 'rolldown'` 出现在 public type 里。

如果想避免强 peer，可以 `src/rolldown.ts` 不直接 import Rolldown 类型：

```ts
import type { Options } from './options.js'
import { createDtsPlugin } from './shared-plugin.js'

export type { Options }

export function rolldownDts(options: Options = {}) {
  return createDtsPlugin(options, {
    bundler: 'rolldown',
  })
}

export default rolldownDts
```

这样最干净。

---

## 12. Rolldown 配置使用示例

```ts
import { defineConfig } from 'rolldown'
import { rolldownDts } from 'rollup-plugin-dts/rolldown'

export default defineConfig({
  input: './temp/packages/compiler/src/index.d.ts',
  output: {
    file: './packages/compiler/dist/compiler.d.ts',
    format: 'esm',
  },
  plugins: [
    rolldownDts({
      respectExternal: false,
    }),
  ],
})
```

如果你要在 Zeus 里试：

```ts
// scripts/rolldown.dts.config.ts
import { defineConfig } from 'rolldown'
import { rolldownDts } from 'rollup-plugin-dts/rolldown'

export default defineConfig({
  input: './temp/packages/compiler/src/index.d.ts',
  output: {
    file: './packages/compiler/dist/compiler.d.ts',
    format: 'esm',
  },
  plugins: [rolldownDts()],
})
```

---

## 13. 不建议第一版做的事

第一版别做这些：

```txt
1. 不要直接删除 Rollup 支持
2. 不要重写 transform/index.ts
3. 不要强行用 Rolldown 的 Rust parser 解析 .d.ts
4. 不要把 API 设计成自动识别 bundler
5. 不要支持所有 Rollup 插件组合
```

因为 `rollup-plugin-dts` 官方就不推荐和其他 resolver 插件组合使用，它本身通过 TypeScript compiler 做 resolution。([GitHub][1])

---

## 14. 最小落地 PR 拆分

我建议拆成 4 个 PR：

```txt
PR 1：重构，不改变行为
- 抽 createDtsPlugin()
- 抽 getModule()
- 抽 resolveDtsId()
- 原 dts() 行为不变
- 所有现有 Rollup 测试通过

PR 2：新增 rolldown 入口
- 新增 src/rolldown.ts
- 新增 exports["./rolldown"]
- 新增 rolldown 基础测试

PR 3：修 Rolldown 特有 case
- .d.ts parser 问题
- external 问题
- 多 entry 问题
- Windows path 问题

PR 4：文档与示例
- README 加 Rolldown usage
- 加限制说明
- 加 migration guide
```

---

## 15. 最推荐实现路线

你这个 fork 最适合走：

```txt
保守兼容层，而不是完全 fork 成 rolldown-plugin-dts。
```

因为现在已有代码的 TypeScript Program、模块解析、emitDts 逻辑都可以复用。尤其当前源码已经在 `transform()` 中覆盖 `.d.ts`、`.json`、`.ts` 三类入口，并通过 `ts.resolveModuleName()` 处理模块解析。

最终目标：

```ts
// Rollup
import { dts } from 'rollup-plugin-dts'

// Rolldown
import { rolldownDts } from 'rollup-plugin-dts/rolldown'
```

这样风险最低，也最容易维护。

[1]: https://github.com/Swatinem/rollup-plugin-dts 'GitHub - Swatinem/rollup-plugin-dts: A rollup plugin to generate .d.ts rollup files for your typescript project · GitHub'
[2]: https://rolldown.rs/apis/plugin-api 'Plugin API | Rolldown'
