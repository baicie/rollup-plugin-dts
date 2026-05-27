# 构建失败分析报告

## 1. 问题概述

全量构建 `pnpm build -t` 失败，退出码 1。

## 2. 错误信息

### 第一阶段：rolldown 构建（已通过）

rolldown JS 产物构建全部成功，无 OOM 复现：

```
✔ rolldown v1.0.2 Finished in 245.90 ms
```

各包产物正常输出：
- `compiler.global.prod.js` — 295 kB（gzip: 59.3 kB）
- `runtime-dom.global.prod.js` — 24.9 kB（gzip: 8.71 kB）
- `signal.global.prod.js` — 20.8 kB（gzip: 7.59 kB）
- `zeus.global.prod.js` — 28.2 kB（gzip: 10 kB）

### 第二阶段：build-dts 声明文件打包（失败）

```
 ERROR  Build failed with 34 errors:
[MISSING_EXPORT] "template" is not exported by "temp/packages/runtime-dom/src/template.d.ts".
[MISSING_EXPORT] "render" is not exported by "temp/packages/runtime-dom/src/render.d.ts".
[MISSING_EXPORT] "insert" is not exported by "temp/packages/runtime-dom/src/insert.d.ts".
[MISSING_EXPORT] "mountDynamic" is not exported by "temp/packages/runtime-dom/src/insert.d.ts".
[MISSING_EXPORT] "marker" is not exported by "temp/packages/runtime-dom/src/dom.d.ts".
...（共 34 个）
```

## 3. 根因分析

### 直接原因

`@baicie/plugin-dts/rolldown` 插件的 `fixModifiers` 函数存在 bug，将 `export declare function` 降级为无导出的 `declare function`。

### 代码位置

```
node_modules/@baicie/plugin-dts/dist/rolldown.mjs:1434
```

```javascript
function fixModifiers(code, node) {
    // remove the `export` and `default` modifier, add a `declare` if its missing.
    // ...
    if (isTopLevel) {
        // For top-level statements, remove `export`/`default` and ensure `declare` exists
        for (const mod of node.modifiers ?? []) {
            switch (mod.kind) {
                case ts.SyntaxKind.ExportKeyword:
                    code.remove(mod.getStart(), mod.getEnd() + 1); // 移除了 export
                    break;
            }
        }
        // ...
    }
}
```

### 影响链条

1. `rolldownDts` 对 `temp/packages/runtime-dom/src/template.d.ts` 进行 transform
2. `fixModifiers` 将 `export declare function template(...)` 中的 `export` 移除
3. 转换后的代码变为 `declare function template(...)` — `template` 不再是导出
4. rolldown 在 bundle `index.d.ts` 的 re-export `export { template } from './template'` 时，找不到 `template` 的导出
5. 触发 `MISSING_EXPORT` 错误

### 复现条件

此 bug 不稳定复现。之前的一次构建中出现过偶发 OOM（`memory allocation of 48 bytes failed`），但本次全量构建 rolldown JS 构建成功，仅 `build-dts` 阶段失败。

## 4. 解决方案

### 方案一：替换插件（推荐）

用 `rolldown-plugin-dts` 替换 `@baicie/plugin-dts/rolldown`。

`rolldown-plugin-dts` 同样可以完成 `.d.ts` bundle 工作，且对 `export declare function` 保留导出语义。

修改文件：`scripts/rolldown.dts.config.ts`

```diff
- import { rolldownDts } from '@baicie/plugin-dts/rolldown'
+ import { dts } from 'rolldown-plugin-dts'

  plugins: [
-   rolldownDts(),
+   dts(),
    patchTypes(pkg),
    ...(pkg === 'zeus' ? [copyMts()] : []),
  ],
```

验证结果：使用 `rolldown-plugin-dts` 可正常 bundle `runtime-dom/index.d.ts`，输出完整声明文件。

### 方案二：等上游修复

给 `@baicie/plugin-dts` 提 issue，等待插件作者修复 `fixModifiers` 函数中对 `export declare function` 的处理逻辑。

## 5. 相关文件

| 文件路径 | 用途 |
|---|---|
| `scripts/rolldown.dts.config.ts` | DTS 打包配置 |
| `scripts/build.ts` | 构建入口脚本 |
| `package.json` | 定义 `build-dts` 脚本 |
| `node_modules/@baicie/plugin-dts/dist/rolldown.mjs` | 问题插件源码 |

## 6. 环境信息

- **Node.js**: v24.16.0
- **rolldown**: v1.0.2
- **pnpm**: v10.33.4
- **系统**: macOS darwin 24.6.0
