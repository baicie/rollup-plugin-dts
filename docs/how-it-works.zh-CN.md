# 它是如何工作的？

本项目以一种非常有趣的方式滥用 Rollup 的内部实现。

你可能不知道，Rollup 使用**字符串操作**来生成输出文件，通过 [MagicString](https://github.com/rich-harris/magic-string) 对输入文件内容进行_修改_和_删除_部分内容。Rollup 还通过遍历输入代码的 AST 并确定哪些部分可以安全地从输出 bundle 中移除，来进行非常彻底的**死代码消除**。

我们可以利用这些知识来精确地引导 Rollup _保留_和_删除_输入文件的某些部分，以及[正确地重命名 Identifier](https://github.com/rollup/rollup/blob/7af842b3af052d1c305e90ac1fbf0cfb8c9fa359/src/ast/nodes/Identifier.ts#L155)。

我们的做法是将 TypeScript 代码转换成一个_虚拟 AST_，它本身只是一段非常奇怪的代码，但能让 Rollup 做我们想让它做的事情。

## 创建声明

对于每个导出（`class`、`function`、`interface` 或 `type`），我们都会为 Rollup 创建一个伪造的 `FunctionDeclaration`。这里的技巧是用特定的 `start` 和 `end` 来标注这个 `FunctionDeclaration`。然后，如果 Rollup 判断出该声明没有被引用，它就会[直接删除](https://github.com/rollup/rollup/blob/7af842b3af052d1c305e90ac1fbf0cfb8c9fa359/src/utils/treeshakeNode.ts#L4-L7)`start` 和 `end` 之间的所有字节，而不会去查看这些字节实际上是什么。

```
function foo() {}
export function bar() {}
```

[在线体验](https://rollupjs.org/repl?version=3.10.0&shareable=JTdCJTIybW9kdWxlcyUyMiUzQSU1QiU3QiUyMm5hbWUlMjIlM0ElMjJtYWluLmpzJTIyJTJDJTIyY29kZSUyMiUzQSUyMmZ1bmN0aW9uJTIwZm9vKCklMjAlN0IlN0QlNUNuZXhwb3J0JTIwZnVuY3Rpb24lMjBiYXIoKSUyMCU3QiU3RCUyMiU3RCU1RCUyQyUyMm9wdGlvbnMlMjIlM0ElN0IlMjJmb3JtYXQlMjIlM0ElMjJlc20lMjIlMkMlMjJuYW1lJTIyJTNBJTIybXlCdW5kbGUlMjIlMkMlMjJhbWQlMjIlM0ElN0IlMjJpZCUyMiUzQSUyMiUyMiU3RCU3RCUyQyUyMmV4YW1wbGUlMjIlM0FudWxsJTdE)

## 创建副作用

Rollup 实际上会分析函数的副作用，并且会愉快地移除没有副作用的函数，即使这些函数在其他地方被引用了。

为了让 Rollup 至少考虑将一个函数放入我们的 bundle 中，我们必须给这个函数引入一个副作用。我们该怎么做？答案是生成一段 Rollup 无法窥探内部的代码。例如，通过调用一个未被引用的标识符。这个标识符可能存在于 `window` 中，而 Rollup 并不知道这一点。所以它不会触碰那段代码。

```
_()
```

[在线体验](https://rollupjs.org/repl?version=3.10.0&shareable=JTdCJTIybW9kdWxlcyUyMiUzQSU1QiU3QiUyMm5hbWUlMjIlM0ElMjJtYWluLmpzJTIyJTJDJTIyY29kZSUyMiUzQSUyMl8oKSUyMiU3RCU1RCUyQyUyMm9wdGlvbnMlMjIlM0ElN0IlMjJmb3JtYXQlMjIlM0ElMjJlc20lMjIlMkMlMjJuYW1lJTIyJTNBJTIybXlCdW5kbGUlMjIlMkMlMjJhbWQlMjIlM0ElN0IlMjJpZCUyMiUzQSUyMiUyMiU3RCU3RCUyQyUyMmV4YW1wbGUlMjIlM0FudWxsJTdE)

## 创建引用

如果有人非常仔细地看了前面的例子，你会发现 Rollup 实际上会在 `CallExpression` 后面插入一个分号。这一点花了我很长时间才弄清楚并找到解决办法。

最终，我决定用函数参数的默认值在不同声明之间创建引用。这样 Rollup 就不会插入那些会扰乱我们 TypeScript 代码的分号。

同样，所有的 `Identifier` 都用正确的 `start` 和 `end` 标记进行了标注。所以如果 Rollup 决定重命名它们，它会正确地触及代码的相关部分。另外，函数名本身也是标识符列表的一部分，因为函数名之前可能有一些标识符，比如类型参数和我们可能想移除的其他东西。

```
function foo(_0 = foo) {}
function bar(_0 = bar, _1 = foo) {}
function baz(_0 = baz) {}
export function foobar(_0 = foobar, _1 = bar, _2 = baz) {}
```

[在线体验](https://rollupjs.org/repl?version=3.10.0&shareable=JTdCJTIybW9kdWxlcyUyMiUzQSU1QiU3QiUyMm5hbWUlMjIlM0ElMjJtYWluLmpzJTIyJTJDJTIyY29kZSUyMiUzQSUyMmZ1bmN0aW9uJTIwZm9vKF8wJTIwJTNEJTIwZm9vKSUyMCU3QiU3RCU1Q25mdW5jdGlvbiUyMGJhcihfMCUyMCUzRCUyMGJhciUyQyUyMF8xJTIwJTNEJTIwZm9vKSUyMCU3QiU3RCU1Q25mdW5jdGlvbiUyMGJheihfMCUyMCUzRCUyMGJheiklMjAlN0IlN0QlNUNuZXhwb3J0JTIwZnVuY3Rpb24lMjBmb29iYXIoXzAlMjAlM0QlMjBmb29iYXIlMkMlMjBfMSUyMCUzRCUyMGJhciUyQyUyMF8yJTIwJTNEJTIwYmF6KSUyMCU3QiU3RCUyMiU3RCU1RCUyQyUyMm9wdGlvbnMlMjIlM0ElN0IlMjJmb3JtYXQlMjIlM0ElMjJlc20lMjIlMkMlMjJuYW1lJTIyJTNBJTIybXlCdW5kbGUlMjIlMkMlMjJhbWQlMjIlM0ElN0IlMjJpZCUyMiUzQSUyMiUyMiU3RCU3RCUyQyUyMmV4YW1wbGUlMjIlM0FudWxsJTdE)

## 移除嵌套代码

在前面例子的基础上，我们可以利用函数参数默认值的列表，以及之前学到的移除顶层代码的方法，来标记嵌套代码进行删除。

对于这种情况，我们创建一个包含一些死代码的箭头函数。正如你在例子中看到的，Rollup 会移除这些代码。同样，只要用 `start` 和 `end` 标记进行标注就行了。

```
function foo(_0 = foo, _1 = () => {removeme}) {}
export function bar(_0 = bar, _1 = foo) {}
```

[在线体验](https://rollupjs.org/repl?version=3.10.0&shareable=JTdCJTIybW9kdWxlcyUyMiUzQSU1QiU3QiUyMm5hbWUlMjIlM0ElMjJtYWluLmpzJTIyJTJDJTIyY29kZSUyMiUzQSUyMmZ1bmN0aW9uJTIwZm9vKF8wJTIwJTNEJTIwZm9vJTJDJTIwXzElMjAlM0QlMjAoKSUyMCUzRCUzRSUyMCU3QnJlbW92ZW1lJTdEKSUyMCU3QiU3RCU1Q25leHBvcnQlMjBmdW5jdGlvbiUyMGJhcihfMCUyMCUzRCUyMGJhciUyQyUyMF8xJTIwJTNEJTIwZm9vKSUyMCU3QiU3RCUyMiU3RCU1RCUyQyUyMm9wdGlvbnMlMjIlM0ElN0IlMjJmb3JtYXQlMjIlM0ElMjJlc20lMjIlMkMlMjJuYW1lJTIyJTNBJTIybXlCdW5kbGUlMjIlMkMlMjJhbWQlMjIlM0ElN0IlMjJpZCUyMiUzQSUyMiUyMiU3RCU3RCUyQyUyMmV4YW1wbGUlMjIlM0FudWxsJTdE)

有了这些工具，我们就能创建 Rollup 的 `.d.ts` 文件了。

## Sourcemap 带来的挑战

虚拟 AST 技巧给 sourcemap 带来了一个问题：**["转到定义"功能会失效](https://code.visualstudio.com/docs/languages/typescript#_code-navigation)**。

TypeScript 的声明映射文件（`.d.ts.map`）具有[每个 token 的粒度](https://github.com/microsoft/TypeScript/blob/b19a9da2a3b8f2a720d314d01258dd2bdc110fef/src/compiler/emitter.ts#L6234-L6240)——像 `User`、`id`、`name` 这样的每个标识符都有自己的映射。这使得"转到定义"能够跳转到精确的标识符，而不仅仅是行。

但 Rollup 的 bundle sourcemap 是**稀疏的**。它只在声明边界处有映射，而不是每个标识符都有。为什么会这样？因为我们的虚拟 AST 只有带有 `start`/`end` 标记的 `FunctionDeclaration` 节点——没有 token 级别的细节供 Rollup 保留。

### 为什么 MagicString/Rollup 无法解决这个问题？

它们确实能正确处理 sourcemap——瓶颈在于 Rollup 的 bundle map 生成过程。

MagicString 工作正常；我们在 transform hook 中使用了 `hires: true`。Rollup 通过 `collapseSourcemaps` 正确地[组合了映射链](https://github.com/rollup/rollup/blob/7af842b3af052d1c305e90ac1fbf0cfb8c9fa359/src/utils/collapseSourcemaps.ts)。问题是 Rollup 在[生成 bundle map](https://github.com/rollup/rollup/blob/7af842b3af052d1c305e90ac1fbf0cfb8c9fa359/src/utils/renderChunks.ts#L161)时默认使用 `hires: false`，而且没有输出选项可以改变这一点。

即使 Rollup 支持 `hires: true`，也没有帮助——我们的虚拟 AST 没有真正的 token 位置，只有 `FunctionDeclaration` 的边界。

### 为什么标准重映射方法会失败

你可能会想 [`@jridgewell/remapping`](https://github.com/jridgewell/remapping) 可以在事后组合 Rollup 的 map 和输入的 `.d.ts.map`。但它无法恢复丢失的细节。

重映射是**追踪**段（segment）的——对于外层 map 中的每个段，它查找该位置在内层 map 中的映射位置。它无法**添加**外层 map 中不存在的段。

```
Rollup 的稀疏 map:      6 个段  (外层)
输入的 .d.ts.map:       17 个段  (内层)
重映射后的结果:          3 个段  (变少了，而不是变多！)
```

外层 map 的粒度是上限。重映射只能丢失细节，无法增加细节。

### 稀疏锚点水合（Sparse-anchor hydration）

我们没有使用重映射，而是用 Rollup 的稀疏 map 作为"锚点"来找到每个输出行来自哪一行源文件，然后从输入 map 中复制详细的段：

```
对于每个输出行：
  1. 在 Rollup 的 map 中找到第一个映射的段（"锚点"）
  2. 从锚点中提取源行号
  3. 从输入 map 中复制该源行的所有段
  4. 通过差值调整列号：anchorOutputCol - anchorSourceCol
```

这之所以有效，是因为 TypeScript 保留了行结构——声明在打包过程中保持在其原始行上。锚点告诉我们"这个输出行来自源文件的第 N 行"，而我们知道输入 map 在第 N 行有详细的每个标识符的映射。

我们将 sourcemap 处理推迟到 `generateBundle` 而不是 `transform` 中进行。即使在 `transform` 中组合了 map，Rollup 的打包过程仍然会产生稀疏的输出 map。另外，`options.sourcemap` 是一个输出选项——在 `transform` 中不可用。通过推迟处理，当 sourcemap 被禁用时，我们也可以完全跳过加载输入 sourcemap。

### 输入路径

当设置了 `dts({ sourcemap: true })` 时，插件处理两种输入类型：

- **`.d.ts` 文件**：从磁盘加载外部的 `.d.ts.map` 文件
- **`.ts` 文件**：在 `program.emit()` 期间捕获 TypeScript 的内存中声明 map

如果没有此选项，sourcemap 保持稀疏（来自 MagicString 的基本行级映射）。

对于 `.ts` 输入，我们从发出的声明中移除 `//# sourceMappingURL` 注释。TypeScript 会发出外部 map 引用，但我们通过 `inputMapText` 直接传递 map。如果不剥离，Rollup 会双重处理 sourcemap。

### 实现细节

**sourcesContent 被拒绝**：tsserver [会拒绝](https://github.com/microsoft/TypeScript/blob/b19a9da2a3b8f2a720d314d01258dd2bdc110fef/src/services/sourcemaps.ts#L226)包含 `sourcesContent` 的 sourcemap，静默回退到无映射状态：

```typescript
if (map.sourcesContent && map.sourcesContent.some(isString)) return undefined;
```

我们从输出 map 中完全剥离 `sourcesContent` 以保持兼容性。

**URL 形式的 sourceRoot**：TypeScript 的 `sourceRoot` 可以是 URL 形式，比如 `https://github.com/org/repo/blob/main/src/`。我们通过 `://` 模式（而不仅仅是 `:`，因为 `:` 也会匹配 Windows 驱动器号）检测 URL，并使用 [`URL` 构造函数](https://developer.mozilla.org/en-US/docs/Web/API/URL/URL) 进行正确的路径解析——`new URL("../../src/index.ts", "https://example.com/dist/types/")` 会正确产生 `https://example.com/src/index.ts`。

### 依赖库

- [`convert-source-map`](https://github.com/thlorenz/convert-source-map) — 加载输入 sourcemap（内联 base64、URL 编码、文件引用）
- [`@jridgewell/sourcemap-codec`](https://github.com/jridgewell/sourcemap-codec) — 解码/编码 VLQ 映射
- [`@jridgewell/remapping`](https://github.com/jridgewell/remapping) — 为多源情况组合 sourcemap
