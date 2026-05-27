import { publish } from '@baicie/release'

publish({
  defaultPackage: 'plugin-dts',
  packageManager: 'pnpm',
  getPkgDir: () => '.',
})
