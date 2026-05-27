import { publish } from "@baicie/release";

publish({ defaultPackage: "@baicie/plugin-dts", packageManager: "pnpm", getPkgDir: () => "." });
