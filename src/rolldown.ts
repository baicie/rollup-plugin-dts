import type { Options } from './options.js'
import { createDtsPlugin } from './shared-plugin.js'

export type { Options }

export function rolldownDts(options: Options = {}) {
  return createDtsPlugin(options, {
    bundler: 'rolldown',
  })
}

export default rolldownDts
