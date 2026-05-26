import ts from "typescript";
import { createProgram } from "../program.js";
import { DTS_EXTENSIONS } from "../helpers.js";
import type { DtsPluginContext, ResolvedModule } from "./context.js";

export function getModule(
  { entries, programs, resolvedOptions }: DtsPluginContext,
  fileName: string,
  code: string,
): ResolvedModule | null {
  const { compilerOptions, tsconfig } = resolvedOptions;

  if (!programs.length && DTS_EXTENSIONS.test(fileName)) {
    return { code };
  }

  const isEntry = entries.includes(fileName);

  const existingProgram = programs.find((p) => {
    if (isEntry) {
      return p.getRootFileNames().includes(fileName);
    }
    const sourceFile = p.getSourceFile(fileName);
    if (sourceFile && p.isSourceFileFromExternalLibrary(sourceFile)) {
      return false;
    }
    return !!sourceFile;
  });

  if (existingProgram) {
    const source = existingProgram.getSourceFile(fileName)!;
    return {
      code: source.getFullText(),
      source,
      program: existingProgram,
    };
  }

  if (!ts.sys.fileExists(fileName)) {
    return null;
  }

  if (programs.length > 0 && DTS_EXTENSIONS.test(fileName)) {
    const shouldBundleExternal = resolvedOptions.includeExternal.length > 0 || resolvedOptions.respectExternal;
    if (shouldBundleExternal) {
      return { code };
    }
  }

  const newProgram = createProgram(fileName, compilerOptions, tsconfig, resolvedOptions.sourcemap);
  programs.push(newProgram);
  const source = newProgram.getSourceFile(fileName)!;
  return {
    code: source.getFullText(),
    source,
    program: newProgram,
  };
}
