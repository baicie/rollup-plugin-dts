import { release } from "@baicie/release";

release({
  repo: "baicie/rollup-plugin-dts",
  packages: ["@baicie/plugin-dts"],
  toTag: (pkg, version) => `${pkg}@${version}`,
  generateChangelog: (_pkg) => {},
  getPkgDir: () => ".", // 指定根目录
});
