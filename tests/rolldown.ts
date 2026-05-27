import * as assert from "assert";
import fs from "fs/promises";
import * as path from "path";
import { rolldown as bundleWithRolldown } from "rolldown";
import { rolldownDts } from "../src/rolldown.js";
import { exists, forEachFixture, Harness } from "./utils.js";

export default (t: Harness) => {
  forEachFixture("rolldown", (name, dir) => {
    t.test(`rolldown/${name}`, (bless) => {
      return assertTestcase(dir, bless);
    });
  });
};

async function assertTestcase(dir: string, bless: boolean) {
  const input = path.join(dir, "index.d.ts");
  const bundle = await bundleWithRolldown({
    input,
    plugins: [rolldownDts()],
  });
  const { output } = await bundle.generate({
    format: "es",
  });
  const code = output[0]?.code ?? "";

  await assertExpectedResult(path.join(dir, "expected.d.ts"), code, bless);
}

async function assertExpectedResult(file: string, code: string, bless: boolean) {
  const hasExpected = await exists(file);
  if (!hasExpected || bless) {
    await fs.writeFile(file, code);
  }

  const expectedCode = await fs.readFile(file, "utf-8");
  assert.strictEqual(code, expectedCode);
}
