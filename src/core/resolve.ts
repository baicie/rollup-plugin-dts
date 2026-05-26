import * as path from "node:path";
import ts from "typescript";
import { getCompilerOptions } from "../program.js";
import type { DtsPluginContext } from "./context.js";

export interface ResolveResult {
  id: string;
  external?: boolean;
}

export function resolveDtsId(ctx: DtsPluginContext, source: string, importer?: string): ResolveResult | null {
  if (!importer) {
    ctx.entries.push(path.resolve(source));
    return null;
  }

  const normalizedImporter = importer.split("\\").join("/");

  let resolvedCompilerOptions = ctx.resolvedOptions.compilerOptions;
  if (ctx.resolvedOptions.tsconfig) {
    const resolvedSource = source.startsWith(".") ? path.resolve(path.dirname(normalizedImporter), source) : source;
    resolvedCompilerOptions = getCompilerOptions(
      resolvedSource,
      ctx.resolvedOptions.compilerOptions,
      ctx.resolvedOptions.tsconfig,
      ctx.resolvedOptions.sourcemap,
    ).compilerOptions;
  }

  const { resolvedModule } = ts.resolveModuleName(source, normalizedImporter, {
    moduleResolution: ts.ModuleResolutionKind.Node10,
    ...resolvedCompilerOptions,
  }, ts.sys);

  if (!resolvedModule) {
    return null;
  }

  const packageName = resolvedModule.packageId?.name;

  if (resolvedModule.isExternalLibraryImport && packageName && ctx.resolvedOptions.includeExternal.includes(packageName)) {
    return {
      id: path.resolve(resolvedModule.resolvedFileName),
    };
  }

  if (!ctx.resolvedOptions.respectExternal && resolvedModule.isExternalLibraryImport) {
    return {
      id: source,
      external: true,
    };
  }

  return {
    id: path.resolve(resolvedModule.resolvedFileName),
  };
}
