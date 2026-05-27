import { rolldownDts } from "@baicie/plugin-dts/rolldown";

export default [
  // Bundle JS output
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.js",
      format: "es",
    },
  },
  // Bundle .d.ts output
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.d.ts",
      format: "es",
    },
    plugins: [rolldownDts()],
  },
];
