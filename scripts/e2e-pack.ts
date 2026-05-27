import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();

function bin(command: string): string {
  if (process.platform !== "win32") return command;
  return command.endsWith(".cmd") ? command : `${command}.cmd`;
}

function run(command: string, args: string[], cwd = root): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin(command), args, {
      cwd,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${command} ${args.join(" ")}`));
    });
  });
}

async function main(): Promise<void> {
  await run("pnpm", ["build"]);
  await run("pnpm", ["pack", "--pack-destination", "temp"]);

  const tarball = readdirSync(path.resolve(root, "temp")).find((file) =>
    file.endsWith(".tgz"),
  );

  assert.ok(tarball, "Expected pnpm pack to create a .tgz file");

  const tarballPath = path.resolve(root, "temp", tarball);
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "plugin-dts-pack-e2e-"));

  writeFileSync(
    path.join(fixtureDir, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        scripts: {
          build: "rollup -c rollup.config.mjs && rolldown -c rolldown.config.mjs",
        },
        devDependencies: {
          rollup: "^4.60.4",
          rolldown: "^1.0.2",
          typescript: "^6.0.3",
        },
      },
      null,
      2,
    ),
  );

  mkdirSync(path.join(fixtureDir, "src"));

  writeFileSync(
    path.join(fixtureDir, "src/index.ts"),
    `
export interface Foo {
  id: number
  name: string
}

export function createFoo(name: string): Foo {
  return {
    id: 1,
    name,
  }
}
`,
  );

  writeFileSync(
    path.join(fixtureDir, "rollup.config.mjs"),
    `
import { dts } from "@baicie/plugin-dts"

export default {
  input: "src/index.ts",
  output: {
    file: "dist/rollup.d.ts",
    format: "es",
  },
  plugins: [dts()],
}
`,
  );

  writeFileSync(
    path.join(fixtureDir, "rolldown.config.mjs"),
    `
import { rolldownDts } from "@baicie/plugin-dts/rolldown"

export default {
  input: "src/index.ts",
  output: {
    file: "dist/rolldown.d.ts",
    format: "es",
  },
  plugins: [rolldownDts()],
}
`,
  );

  await run("pnpm", ["install", tarballPath], fixtureDir);
  await run("pnpm", ["build"], fixtureDir);

  const rollupDts = path.join(fixtureDir, "dist/rollup.d.ts");
  const rolldownDts = path.join(fixtureDir, "dist/rolldown.d.ts");

  assert.equal(existsSync(rollupDts), true);
  assert.equal(existsSync(rolldownDts), true);

  assert.match(readFileSync(rollupDts, "utf-8"), /interface Foo/);
  assert.match(readFileSync(rolldownDts, "utf-8"), /interface Foo/);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
