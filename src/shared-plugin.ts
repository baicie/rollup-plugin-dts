import * as path from 'node:path'
import type { Plugin, TransformResult } from 'rollup'
import { type Options, resolveDefaultOptions } from './options.js'
import { createPrograms } from './program.js'
import { transform } from './transform/index.js'
import {
  DTS_EXTENSIONS,
  JSON_EXTENSIONS,
  getDeclarationId,
  trimExtension,
} from './helpers.js'
import { createDtsContext } from './core/context.js'
import { getModule } from './core/module.js'
import { resolveDtsId } from './core/resolve.js'
import { TS_EXTENSIONS } from './core/constants.js'

export interface CreateDtsPluginOptions {
  bundler: 'rollup' | 'rolldown'
}

function isVirtualModuleId(id: string): boolean {
  return id[0] === '\0'
}

export function createDtsPlugin(
  options: Options = {},
  compat: CreateDtsPluginOptions,
): Plugin {
  const resolvedOptions = resolveDefaultOptions(options)
  const ctx = createDtsContext(resolvedOptions)
  const transformPlugin = transform(resolvedOptions.sourcemap)
  const rolldownDtsModules = new Map<string, string>()

  const rememberRolldownDts = (
    id: string,
    result: TransformResult,
  ): TransformResult => {
    if (
      compat.bundler !== 'rolldown' ||
      !result ||
      typeof result !== 'object' ||
      !('code' in result)
    ) {
      return result
    }

    rolldownDtsModules.set(id.split('\\').join('/'), String(result.code))
    return result
  }

  const getRolldownChunkCode = (chunk: {
    modules?: Record<string, unknown>
  }): string | undefined => {
    if (compat.bundler !== 'rolldown') {
      return undefined
    }

    for (const id of Object.keys(chunk.modules || {})) {
      const normalizedId = id.split('\\').join('/')
      const declarationId = getDeclarationId(normalizedId).split('\\').join('/')
      const code =
        rolldownDtsModules.get(normalizedId) ??
        rolldownDtsModules.get(declarationId)
      if (code) {
        return code
      }
    }
    return undefined
  }

  return {
    name: compat.bundler === 'rolldown' ? 'rolldown-dts' : 'dts',

    outputOptions: transformPlugin.outputOptions,
    renderChunk(inputCode, chunk, outputOptions, meta) {
      return transformPlugin.renderChunk.call(
        this,
        getRolldownChunkCode(chunk) ?? inputCode,
        chunk,
        outputOptions,
        meta,
      )
    },
    generateBundle: transformPlugin.generateBundle,

    options(inputOptions) {
      let { input = [] } = inputOptions

      if (!Array.isArray(input)) {
        input = typeof input === 'string' ? [input] : Object.values(input)
      } else if (input.length > 1) {
        inputOptions.input = {}
        for (const filename of input) {
          let name = trimExtension(filename)
          if (path.isAbsolute(filename)) {
            name = path.basename(name)
          } else {
            name = path.normalize(name)
          }
          inputOptions.input[name] = filename
        }
      }

      ctx.programs = createPrograms(
        Object.values(input),
        resolvedOptions.compilerOptions,
        resolvedOptions.tsconfig,
        resolvedOptions.sourcemap,
      )

      return transformPlugin.options.call(this, inputOptions)
    },

    resolveId(source, importer) {
      if (isVirtualModuleId(source) || (importer && isVirtualModuleId(importer))) {
        return null
      }

      const resolved = resolveDtsId(ctx, source, importer)
      if (!resolved) {
        return null
      }
      return resolved
    },

    transform(code, id) {
      if (isVirtualModuleId(id)) {
        return null
      }

      if (
        !TS_EXTENSIONS.test(id) &&
        !DTS_EXTENSIONS.test(id) &&
        !JSON_EXTENSIONS.test(id)
      ) {
        return null
      }

      const watchFiles = (module: ReturnType<typeof getModule>) => {
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
        if (!module) return null
        watchFiles(module)
        return rememberRolldownDts(
          id,
          transformPlugin.transform.call(this, module.code, id),
        )
      }

      const treatTsAsDts = () => {
        const declarationId = getDeclarationId(id)
        const module = getModule(ctx, declarationId, code)
        if (!module) return null
        watchFiles(module)
        return rememberRolldownDts(
          declarationId,
          transformPlugin.transform.call(this, module.code, declarationId),
        )
      }

      const generateDts = () => {
        const module = getModule(ctx, id, code)
        if (!module?.source || !module.program) return null
        watchFiles(module)

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
          // @ts-ignore This is a private API for workers, should be safe to use as TypeScript Playground has used it for a long time.
          true,
        )

        if (emitSkipped) {
          const errors = diagnostics.filter(diag => diag.category === 1)
          if (errors.length) {
            this.error('Failed to compile.')
          }
        }

        if (!declarationText) return null

        const cleanDeclarationText = declarationText.replace(
          /\n?\/\/# sourceMappingURL=[^\n]+/,
          '',
        )
        return rememberRolldownDts(
          declarationId,
          transformPlugin.transform.call(
            this,
            cleanDeclarationText,
            declarationId,
            declarationMapText,
          ),
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
