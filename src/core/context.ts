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
