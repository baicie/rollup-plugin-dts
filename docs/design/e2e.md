有必要，而且你这个仓库现在非常适合做 E2E。

原因是你已经有两个真实 example：

```txt
examples/rollup
examples/rolldown
```

并且 workspace 里已经包含了它们。

其中 Rollup example 使用的是主入口：

```ts
import { dts } from "@baicie/plugin-dts";
```

并输出 `dist/index.d.ts`。

Rolldown example 使用的是子入口：

```ts
import { rolldownDts } from "@baicie/plugin-dts/rolldown";
```

并同时输出 `dist/index.js` 和 `dist/index.d.ts`。

所以 E2E 正好可以验证这几个关键点：

```txt
1. exports["."] 是否可用
2. exports["./rolldown"] 是否可用
3. workspace 安装后的真实消费是否正常
4. rollup / rolldown 两个宿主是否都能跑通
5. 最终 .d.ts 是否真的包含预期类型
```

---

## 推荐测试分层

建议分两层。

第一层：**examples workspace E2E**，也就是你现在最应该做的。

```txt
pnpm build
pnpm --filter @baicie/plugin-dts-example-rollup build
pnpm --filter @baicie/plugin-dts-example-rolldown build
检查 examples/*/dist/index.d.ts
检查 rolldown 的 dist/index.js
```

第二层：**pack E2E**，发布前再做。

```txt
pnpm pack
临时目录 pnpm add ./xxx.tgz
真实项目 import @baicie/plugin-dts 和 @baicie/plugin-dts/rolldown
```

第一版先做第一层就够了。

---

# 一、package.json 脚本设计

你现在 root package 里已经有：

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json && rollup -c",
    "test": "c8 node temp/tests/index.js"
  }
}
```

可以改成：

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json && rollup -c",
    "test": "c8 node temp/tests/index.js",
    "test:e2e": "tsx scripts/e2e.ts",
    "test:all": "pnpm test && pnpm test:e2e"
  }
}
```

如果想让 `prepublishOnly` 更稳：

```json
{
  "scripts": {
    "prepublishOnly": "pnpm test:all"
  }
}
```

---

# 二、E2E 脚本代码草案

新增：

```txt
scripts/e2e.ts
```

代码：

```ts
import { spawn } from "node:child_process";
import { existsSync, rmSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();

const examples = [
  {
    name: "rollup",
    filter: "@baicie/plugin-dts-example-rollup",
    dir: path.resolve(root, "examples/rollup"),
    expectedFiles: ["dist/index.d.ts"],
  },
  {
    name: "rolldown",
    filter: "@baicie/plugin-dts-example-rolldown",
    dir: path.resolve(root, "examples/rolldown"),
    expectedFiles: ["dist/index.d.ts", "dist/index.js"],
  },
] as const;

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
      env: {
        ...process.env,
        FORCE_COLOR: "1",
      },
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed: ${command} ${args.join(" ")} with exit code ${code}`));
    });
  });
}

function cleanExampleDist(): void {
  for (const example of examples) {
    const dist = path.join(example.dir, "dist");

    if (existsSync(dist)) {
      rmSync(dist, {
        recursive: true,
        force: true,
      });
    }
  }
}

function assertFileExists(filePath: string): void {
  assert.equal(existsSync(filePath), true, `Expected file to exist: ${filePath}`);

  assert.equal(statSync(filePath).isFile(), true, `Expected path to be file: ${filePath}`);
}

function assertDtsContent(filePath: string): void {
  const code = readFileSync(filePath, "utf-8");

  const expectedSnippets = [
    "interface User",
    "interface Config",
    "type Status",
    "createUser",
    "validateConfig",
    "class ApiClient",
  ];

  for (const snippet of expectedSnippets) {
    assert.match(
      code,
      new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `Expected ${filePath} to contain ${snippet}`,
    );
  }

  assert.doesNotMatch(
    code,
    /from\s+["']\.\/src|from\s+["']src\//,
    `Expected ${filePath} to be bundled and not reference src modules`,
  );
}

async function main(): Promise<void> {
  console.log("[e2e] clean example dist");
  cleanExampleDist();

  console.log("[e2e] build root package");
  await run("pnpm", ["build"]);

  for (const example of examples) {
    console.log(`[e2e] build ${example.name} example`);
    await run("pnpm", ["--filter", example.filter, "build"]);

    for (const relativeFile of example.expectedFiles) {
      const filePath = path.join(example.dir, relativeFile);
      assertFileExists(filePath);
    }

    assertDtsContent(path.join(example.dir, "dist/index.d.ts"));
  }

  console.log("[e2e] all examples passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

这个脚本会真实构建两个 examples，并检查 `.d.ts` 是否包含你的 example 里实际定义的 `User`、`Config`、`Status`、`createUser`、`validateConfig`、`ApiClient`。这些类型和函数目前两个 examples 的源码里都有。

---

# 三、examples 的 package.json 保持现状即可

Rollup example 现在：

```json
{
  "scripts": {
    "build": "rollup -c rollup.config.mts"
  },
  "dependencies": {
    "@baicie/plugin-dts": "workspace:*"
  }
}
```

这个是对的。

Rolldown example 现在：

```json
{
  "scripts": {
    "build": "rolldown -c"
  },
  "dependencies": {
    "@baicie/plugin-dts": "workspace:*"
  }
}
```

也对。

不需要一开始就把 examples 搞复杂。

---

# 四、CI 设计

新增：

```txt
.github/workflows/ci.yml
```

```yaml
name: CI

on:
  push:
    branches:
      - rolldown
      - main
  pull_request:

jobs:
  test:
    runs-on: ${{ matrix.os }}

    strategy:
      fail-fast: false
      matrix:
        os:
          - ubuntu-latest
          - windows-latest
        node:
          - 20
          - 22
          - 24
          - 26

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.33.4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Unit tests
        run: pnpm test

      - name: E2E tests
        run: pnpm test:e2e
```

因为你的插件要兼容 Rollup/Rolldown，而且 Windows 下之前也遇到过 `spawn ENOENT` 这种问题，所以 E2E 最好至少跑：

```txt
ubuntu-latest
windows-latest
```

Node 版本可以先收敛一点：

```yaml
node:
  - 20
  - 22
  - 26
```

---

# 五、要不要做 pack E2E？

有必要，但可以放第二阶段。

为什么？因为 workspace E2E 验证的是：

```txt
源码仓库内消费 OK
```

pack E2E 验证的是：

```txt
发布后的 npm 包消费 OK
```

它能发现这类问题：

```txt
1. files 字段漏了 dist
2. exports 写错
3. types 指向不存在
4. dependencies 漏了 @babel/code-frame
5. peer optional 配置不合理
```

你现在 `files` 只包含 `dist`。 所以 pack E2E 后续很值得加。

---

## pack E2E 草案

新增：

```txt
scripts/e2e-pack.ts
```

```ts
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
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

  const tarball = readdirSync(path.resolve(root, "temp")).find((file) => file.endsWith(".tgz"));

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
```

package.json 后续加：

```json
{
  "scripts": {
    "test:e2e:pack": "tsx scripts/e2e-pack.ts"
  }
}
```

---

# 六、最终建议

第一阶段直接加：

```txt
scripts/e2e.ts
pnpm test:e2e
CI 里跑 pnpm test:e2e
```

先验证 examples 下两个真实项目：

```txt
examples/rollup    -> import { dts } from "@baicie/plugin-dts"
examples/rolldown  -> import { rolldownDts } from "@baicie/plugin-dts/rolldown"
```

第二阶段再加：

```txt
scripts/e2e-pack.ts
pnpm test:e2e:pack
```

用来验证发布包是否真的可用。

我建议你现在先做第一阶段，因为投入很小，但能马上防住 `exports`、`peerDependencies`、`rolldown` 子入口、Windows spawn、产物缺失这些高频问题。
