import type { PluginImpl } from "rollup";
import { createDtsPlugin } from "./shared-plugin.js";
import type { Options } from "./options.js";

export type { Options };

const plugin: PluginImpl<Options> = (options = {}) => {
  return createDtsPlugin(options, {
    bundler: "rollup",
  });
};

export { plugin as dts, plugin as default };
