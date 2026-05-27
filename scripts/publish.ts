import { publish } from "@baicie/release";

publish({ defaultPackage: "ncu", packageManager: "pnpm", getPkgDir: () => "." });
