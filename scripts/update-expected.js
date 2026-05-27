import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const testsDir = path.join(rootDir, 'tests', 'testcases')
const preprocessDir = path.join(rootDir, 'tests', 'preprocess')

// Patterns that indicate an export declare pattern that should keep export
const EXPORT_DECLARE_PATTERNS = [
  /^export declare function /m,
  /^export declare class /m,
  /^export declare abstract class /m,
  /^export declare const /m,
  /^export declare interface /m,
  /^export declare type /m,
  /^export declare enum /m,
  /^export declare namespace /m,
]

function shouldKeepExport(code) {
  return EXPORT_DECLARE_PATTERNS.some(pattern => pattern.test(code))
}

function convertToExportDeclare(code) {
  // Pattern 1: `declare function foo()` + `export { foo };` -> `export declare function foo()`
  code = code.replace(
    /^declare function (\w+)\s*\([^)]*\)(<[^>]+>)?(\s*:\s*[^;]+)?;/gm,
    (match, name, generics, returnType) => {
      return `export declare function ${name}${generics || ''}(${getParamsFromReturnType(returnType)})${returnType || ''};`
    },
  )

  // Pattern 2: `declare class Foo` + `export { Foo };` -> `export declare class Foo`
  code = code.replace(
    /^declare class (\w+)/gm,
    (match, name) => {
      // Check if there's an export for this name
      if (code.includes(`export { ${name}`)) {
        return `export declare class ${name}`
      }
      return match
    },
  )

  // Pattern 3: `declare abstract class Foo` + `export { Foo };` -> `export declare abstract class Foo`
  code = code.replace(
    /^declare abstract class (\w+)/gm,
    (match, name) => {
      if (code.includes(`export { ${name}`)) {
        return `export declare abstract class ${name}`
      }
      return match
    },
  )

  // Pattern 4: `declare const foo` + `export { foo };` -> `export declare const foo`
  code = code.replace(
    /^declare const (\w+)/gm,
    (match, name) => {
      if (code.includes(`export { ${name}`) || code.includes(`export { ${name},`)) {
        return `export declare const ${name}`
      }
      return match
    },
  )

  return code
}

function getParamsFromReturnType(returnType) {
  // Extract parameter types from function return type annotation
  if (!returnType) return ''
  // Simple extraction - for now just return empty
  return ''
}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  const original = content

  // First pass: convert declare + export patterns to export declare
  content = convertToExportDeclare(content)

  // Second pass: remove redundant `export { name };` when we have `export declare`
  const lines = content.split('\n')
  const exportDeclarations = new Set()

  // Find all export declare patterns
  for (const line of lines) {
    const match = line.match(/^export declare (function|class|const|interface|type|enum|namespace) (\w+)/)
    if (match) {
      exportDeclarations.add(match[2])
    }
  }

  // Remove export statements for items that are now exported via export declare
  const newLines = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Check for export { name }; pattern
    const exportMatch = line.match(/^export \{ ([^}]+) \};?$/)
    if (exportMatch && i > 0) {
      const exportedNames = exportMatch[1].split(',').map(n => n.trim().split(' as ')[0].trim())
      const keptExports = []
      const removedExports = []

      for (const name of exportedNames) {
        if (exportDeclarations.has(name)) {
          removedExports.push(name)
        } else {
          keptExports.push(name)
        }
      }

      if (keptExports.length > 0) {
        newLines.push(`export { ${keptExports.join(', ')} };`)
      }
      // Skip this line if all exports are now export declare
      continue
    }

    newLines.push(line)
  }

  content = newLines.join('\n')

  if (content !== original) {
    fs.writeFileSync(filePath, content)
    console.log(`Updated: ${filePath}`)
    return true
  }
  return false
}

function processDirectory(dir) {
  let count = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      count += processDirectory(fullPath)
    } else if (entry.name === 'expected.d.ts') {
      if (processFile(fullPath)) {
        count++
      }
    }
  }
  return count
}

console.log('Updating test expectations for export declare fix...\n')

const testcasesCount = processDirectory(testsDir)
console.log(`\nUpdated ${testcasesCount} testcase files`)

console.log('\nDone!')
