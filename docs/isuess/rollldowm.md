根因基本确定：**`@baicie/plugin-dts/rolldown` 把 Rolldown 自己的虚拟 runtime 模块 `\0rolldown/runtime.js` 当成普通 `.js/.ts` 模块处理了**。

你的报错是：

```txt id="4c6qo5"
[PARSE_ERROR] Expected a semicolon or an implicit semicolon after a statement
\0rolldown/runtime.js:1:8

declare var __create = Object.create;
        ^
```

这里最关键的是：

```txt id="nyjvmk"
\0rolldown/runtime.js
```

这是 Rolldown 内部虚拟模块，不是 Zeus 的源码，也不是 tsc 生成的 `.d.ts`。

---

## 为什么会变成 `declare var __create = Object.create`

`@baicie/plugin-dts` 里有这个判断：

```ts id="v2cdfr"
if (
  !TS_EXTENSIONS.test(id) &&
  !DTS_EXTENSIONS.test(id) &&
  !JSON_EXTENSIONS.test(id)
) {
  return null
}
```

而 `TS_EXTENSIONS` 现在是：

```ts id="z79i3b"
export const TS_EXTENSIONS = /\.([cm]ts|[tj]sx?)$/
```

这个正则会匹配：

```txt id="6c2zoq"
runtime.js
```

所以 Rolldown 的虚拟模块：

```txt id="1l6ny0"
\0rolldown/runtime.js
```

也会进入 dts transform。

然后 `preProcess` 里会给变量声明补 `declare`：

```ts id="zhgl1t"
const prefix = `declare ${type} `
```

所以原本 Rolldown runtime 里的 JS：

```js id="mo25k0"
var __create = Object.create
```

被错误处理成了：

```ts id="k44j74"
declare var __create = Object.create;
```

这在 `.d.ts` 里也不合法，因为 `declare var` 不能带初始化表达式；在 JS parser 里更不合法，所以 Rolldown 直接 parse error。

---

## Zeus 配置本身没大问题

你 Zeus 里 dts 配置是：

```ts id="exxrke"
plugins: [
  rolldownDts(),
  patchTypes(pkg),
  ...(pkg === 'zeus' ? [copyMts()] : []),
],
```

这条路线是合理的。真正需要修的是 **`rolldownDts()` 不应该处理 Rolldown 虚拟模块**。

---

# 最佳修复：改 `@baicie/plugin-dts`

在 `src/shared-plugin.ts` 里加虚拟模块过滤。

## 1. 新增判断函数

```ts id="8avgfz"
function isVirtualModuleId(id: string): boolean {
  return id[0] === '\0'
}
```

## 2. 修 `resolveId`

```ts id="69k51u"
resolveId(source, importer) {
  if (isVirtualModuleId(source) || (importer && isVirtualModuleId(importer))) {
    return null
  }

  const resolved = resolveDtsId(ctx, source, importer)
  if (!resolved) {
    return null
  }
  return resolved
}
```

## 3. 修 `transform`

```ts id="03ln6p"
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

  // 原来的逻辑继续
}
```

完整位置就在这个文件：

```txt id="8stgfw"
@baicie/plugin-dts/src/shared-plugin.ts
```

`transform` 当前在 120 行左右，`resolveId` 当前在 112 行左右。

---

## 建议顺手加一条测试

加一个 Rolldown 专用 fixture，确保虚拟模块不会被 dts plugin 处理。

大概思路：

```ts id="lvr0dy"
transform('var __create = Object.create;', '\0rolldown/runtime.js')
// 应该返回 null
```

如果你现有测试体系不方便直接测 plugin hook，可以先加一个单测模拟调用 `rolldownDts().transform`。

---

# Zeus 侧临时绕过方案

如果你暂时不想等 `@baicie/plugin-dts` 发版，可以在 Zeus 里先 `pnpm patch` 这个包。

```bash id="tft3wy"
pnpm patch @baicie/plugin-dts
```

进去改：

```ts id="jhmf6x"
if (id[0] === '\0') {
  return null
}
```

保存后：

```bash id="m8r52f"
pnpm patch-commit <patch-dir>
```

然后重新跑：

```bash id="4ty5jw"
pnpm run build-dts
```

---

# 另一个 Zeus 侧 workaround，不推荐长期用

可以先继续用 Rollup 生成 dts：

```json id="91brv5"
"build-dts": "tsc -p tsconfig.build.json --noCheck && rollup -c ./scripts/rollup.dts.config.ts"
```

你 Zeus 当前 `package.json` 里原本就是 rollup 命令。

但是这个只是绕开 Rolldown 的虚拟 runtime 问题，不能验证 `@baicie/plugin-dts/rolldown` 的正确性。

---

## 结论

不是 Zeus 的 `.d.ts` 语法错，而是：

```txt id="nv9t4s"
@baicie/plugin-dts/rolldown
错误 transform 了 Rolldown 内部虚拟模块 \0rolldown/runtime.js
```

修法就是在 `@baicie/plugin-dts` 的 `resolveId` 和 `transform` 里跳过：

```txt id="y36gqq"
id.startsWith('\0')
```

最小 patch 是：

```ts id="nxm0k8"
if (id[0] === '\0') return null
```

优先加在 `transform()` 开头。更稳一点，同时加到 `resolveId()`。
