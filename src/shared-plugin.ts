import * as path from 'node:path'
import type * as ESTree from 'estree'
import MagicString from 'magic-string'
import type { Plugin, TransformResult } from 'rollup'
import ts from 'typescript'
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

function isValidIdentifier(name: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/.test(name)
}

function printIdentifier(name: string): string {
  return isValidIdentifier(name) ? name : `_${name}`
}

function printExpression(node: ESTree.Node): string {
  switch (node.type) {
    case 'ArrayExpression':
      return `[${node.elements.map(element => (element ? printExpression(element) : '')).join(', ')}]`
    case 'AssignmentPattern':
      return `${printExpression(node.left)} = ${printExpression(node.right)}`
    case 'CallExpression':
      return `${printExpression(node.callee)}(${node.arguments.map(arg => printExpression(arg)).join(', ')})`
    case 'FunctionExpression':
      return `function(${node.params.map(param => printExpression(param)).join(', ')}) ${printBlock(node.body)}`
    case 'Identifier':
      return printIdentifier(node.name)
    case 'Literal':
      return JSON.stringify(node.value)
    case 'MemberExpression':
      return node.computed
        ? `${printExpression(node.object)}[${printExpression(node.property)}]`
        : `${printExpression(node.object)}.${printExpression(node.property)}`
    case 'ObjectExpression':
      return `{ ${node.properties.map(prop => printProperty(prop)).join(', ')} }`
    default:
      return 'undefined'
  }
}

function printProperty(node: ESTree.Property | ESTree.SpreadElement): string {
  if (node.type === 'SpreadElement') {
    return `...${printExpression(node.argument)}`
  }
  const key = node.computed
    ? `[${printExpression(node.key)}]`
    : printExpression(node.key)
  return node.shorthand ? key : `${key}: ${printExpression(node.value)}`
}

function printBlock(node: ESTree.BlockStatement): string {
  return `{${node.body.map(printStatement).join('')}}`
}

function printImportSpecifier(specifier: ESTreeImports[number]): string {
  switch (specifier.type) {
    case 'ImportDefaultSpecifier':
      return printIdentifier(specifier.local.name)
    case 'ImportNamespaceSpecifier':
      return `* as ${printIdentifier(specifier.local.name)}`
    case 'ImportSpecifier': {
      const imported =
        specifier.imported.type === 'Identifier'
          ? printIdentifier(specifier.imported.name)
          : JSON.stringify(specifier.imported.value)
      const local = printIdentifier(specifier.local.name)
      return imported === local ? imported : `${imported} as ${local}`
    }
  }
}

type ESTreeImports = ESTree.ImportDeclaration['specifiers']

function printExportSpecifier(specifier: ESTree.ExportSpecifier): string {
  const local =
    specifier.local.type === 'Identifier'
      ? printIdentifier(specifier.local.name)
      : JSON.stringify(specifier.local.value)
  const exported =
    specifier.exported.type === 'Identifier'
      ? printIdentifier(specifier.exported.name)
      : JSON.stringify(specifier.exported.value)
  return local === exported ? local : `${local} as ${exported}`
}

function printStatement(
  node: ESTree.Statement | ESTree.ModuleDeclaration,
): string {
  switch (node.type) {
    case 'ExportAllDeclaration':
      return node.exported && node.exported.type === 'Identifier'
        ? `export * as ${printIdentifier(node.exported.name)} from ${JSON.stringify(node.source.value)};`
        : `export * from ${JSON.stringify(node.source.value)};`
    case 'ExportDefaultDeclaration':
      return `export default ${printExpression(node.declaration as ESTree.Node)};`
    case 'ExportNamedDeclaration': {
      const specifiers = node.specifiers
        .filter(specifier => specifier.type === 'ExportSpecifier')
        .map(specifier => printExportSpecifier(specifier))
        .join(', ')
      const source = node.source
        ? ` from ${JSON.stringify(node.source.value)}`
        : ''
      return `export { ${specifiers} }${source};`
    }
    case 'ExpressionStatement':
      return `${printExpression(node.expression)};`
    case 'FunctionDeclaration':
      return `function ${printIdentifier(node.id?.name ?? 'anonymous')}(${node.params.map(param => printExpression(param)).join(', ')}) ${printBlock(node.body)}`
    case 'ImportDeclaration': {
      const defaultSpecifiers = node.specifiers.filter(
        specifier => specifier.type === 'ImportDefaultSpecifier',
      )
      const namespaceSpecifiers = node.specifiers.filter(
        specifier => specifier.type === 'ImportNamespaceSpecifier',
      )
      const namedSpecifiers = node.specifiers.filter(
        specifier => specifier.type === 'ImportSpecifier',
      )
      const specifiers = [
        ...defaultSpecifiers.map(printImportSpecifier),
        ...namespaceSpecifiers.map(printImportSpecifier),
        namedSpecifiers.length
          ? `{ ${namedSpecifiers.map(printImportSpecifier).join(', ')} }`
          : '',
      ].filter(Boolean)

      return specifiers.length
        ? `import ${specifiers.join(', ')} from ${JSON.stringify(node.source.value)};`
        : `import ${JSON.stringify(node.source.value)};`
    }
    case 'ReturnStatement':
      return `return ${node.argument ? printExpression(node.argument) : ''};`
    default:
      return ''
  }
}

function printRolldownLinkerCode(ast: ESTree.Program): string {
  return ast.body.map(printStatement).join('\n')
}

function stripRolldownModuleExports(fileName: string, code: string): string {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
  )
  const magicCode = new MagicString(code)

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
      let end = statement.getEnd()
      if (code[end] === ';') {
        end += 1
      }
      if (code[end] === '\n') {
        end += 1
      }
      magicCode.remove(statement.getFullStart(), end)
    }
  }

  return magicCode.toString().trim()
}

function getRolldownChunkExports(fileName: string, code: string): string {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
  )
  return source.statements
    .filter(ts.isExportDeclaration)
    .filter(statement => !statement.moduleSpecifier)
    .map(statement => statement.getText(source))
    .join('\n')
}

function collectDtsDeclarationNames(fileName: string, code: string): string[] {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
  )
  const names: string[] = []
  for (const statement of source.statements) {
    if (
      (ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isModuleDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)) &&
      statement.name &&
      ts.isIdentifier(statement.name)
    ) {
      if (names[names.length - 1] !== statement.name.text) {
        names.push(statement.name.text)
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.push(declaration.name.text)
        }
      }
    }
  }
  return names
}

function collectDtsExportedNames(fileName: string, code: string): Set<string> {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
  )
  const exportedNames = new Set<string>()

  for (const statement of source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const specifier of statement.exportClause.elements) {
        exportedNames.add((specifier.propertyName ?? specifier.name).text)
      }
    }
  }

  return exportedNames
}

function renameDtsIdentifiers(
  fileName: string,
  code: string,
  renames: Map<string, string>,
): string {
  if (!renames.size) {
    return code
  }

  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
  )
  const magicCode = new MagicString(code)

  function visit(node: ts.Node) {
    if (ts.isIdentifier(node)) {
      const replacement = renames.get(node.text)
      if (replacement) {
        magicCode.overwrite(node.getStart(source), node.getEnd(), replacement)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  return magicCode.toString()
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
    if ('ast' in result && result.ast) {
      // Rolldown does not consume Rollup's custom transform AST for linking, so give it equivalent JS.
      return {
        ...result,
        code: printRolldownLinkerCode(result.ast as ESTree.Program),
        map: null,
      }
    }
    return result
  }

  const getRolldownChunkCode = (
    chunk: { fileName: string; modules?: Record<string, unknown> },
    inputCode: string,
  ): string | undefined => {
    if (compat.bundler !== 'rolldown') {
      return undefined
    }

    const modules: Array<{
      declarations: string[]
      exportedNames: Set<string>
      id: string
      stripped: string
    }> = []
    for (const id of Object.keys(chunk.modules || {})) {
      const normalizedId = id.split('\\').join('/')
      const declarationId = getDeclarationId(normalizedId).split('\\').join('/')
      const code =
        rolldownDtsModules.get(normalizedId) ??
        rolldownDtsModules.get(declarationId)
      if (code) {
        const stripped = stripRolldownModuleExports(normalizedId, code)
        if (stripped) {
          modules.push({
            declarations: collectDtsDeclarationNames(normalizedId, stripped),
            exportedNames: collectDtsExportedNames(normalizedId, code),
            id: normalizedId,
            stripped,
          })
        }
      }
    }

    const occurrences = new Map<string, number[]>()
    modules.forEach((module, moduleIndex) => {
      for (const declaration of module.declarations) {
        const existing = occurrences.get(declaration)
        if (existing) {
          existing.push(moduleIndex)
        } else {
          occurrences.set(declaration, [moduleIndex])
        }
      }
    })

    const renameCounts = new Map<string, number>()
    const codes = modules.map((module, moduleIndex) => {
      const renames = new Map<string, string>()
      for (const declaration of module.declarations) {
        const declarationOccurrences = occurrences.get(declaration)
        if (!declarationOccurrences || declarationOccurrences.length < 2) {
          continue
        }

        const preferredModuleIndex =
          declarationOccurrences.find(index =>
            modules[index]?.exportedNames.has(declaration),
          ) ?? declarationOccurrences[declarationOccurrences.length - 1]

        if (moduleIndex !== preferredModuleIndex) {
          const count = (renameCounts.get(declaration) ?? 0) + 1
          renameCounts.set(declaration, count)
          renames.set(declaration, `${declaration}$${count}`)
        }
      }
      return renameDtsIdentifiers(module.id, module.stripped, renames)
    })

    const exports = getRolldownChunkExports(chunk.fileName, inputCode)
    if (exports) {
      codes.push(exports)
    }
    return codes.length ? `${codes.join('\n\n')}\n` : undefined
  }

  return {
    name: compat.bundler === 'rolldown' ? 'rolldown-dts' : 'dts',

    outputOptions: transformPlugin.outputOptions,
    renderChunk(inputCode, chunk, outputOptions, meta) {
      return transformPlugin.renderChunk.call(
        this,
        getRolldownChunkCode(chunk, inputCode) ?? inputCode,
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
      if (
        isVirtualModuleId(source) ||
        (importer && isVirtualModuleId(importer))
      ) {
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

      return generateDts() ?? treatTsAsDts()
    },
  }
}
