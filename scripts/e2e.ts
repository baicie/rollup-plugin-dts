import { spawn } from 'node:child_process'
import { existsSync, rmSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()

const examples = [
  {
    name: 'rollup',
    filter: '@baicie/plugin-dts-example-rollup',
    dir: path.resolve(root, 'examples/rollup'),
    expectedFiles: ['dist/index.d.ts'] as string[],
  },
  {
    name: 'rolldown',
    filter: '@baicie/plugin-dts-example-rolldown',
    dir: path.resolve(root, 'examples/rolldown'),
    expectedFiles: ['dist/index.d.ts', 'dist/index.js'] as string[],
  },
] as const

function bin(command: string): string {
  if (process.platform !== 'win32') return command
  return command.endsWith('.cmd') ? command : `${command}.cmd`
}

function run(command: string, args: string[], cwd = root): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin(command), args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
      },
    })

    child.on('error', reject)

    child.on('close', code => {
      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          `Command failed: ${command} ${args.join(' ')} with exit code ${code}`,
        ),
      )
    })
  })
}

function cleanExampleDist(): void {
  for (const example of examples) {
    const dist = path.join(example.dir, 'dist')

    if (existsSync(dist)) {
      rmSync(dist, {
        recursive: true,
        force: true,
      })
    }
  }
}

function assertFileExists(filePath: string): void {
  assert.equal(
    existsSync(filePath),
    true,
    `Expected file to exist: ${filePath}`,
  )

  assert.equal(
    statSync(filePath).isFile(),
    true,
    `Expected path to be file: ${filePath}`,
  )
}

function assertDtsContent(filePath: string): void {
  const code = readFileSync(filePath, 'utf-8')

  const expectedSnippets = [
    'interface User',
    'interface Config',
    'type Status',
    'createUser',
    'validateConfig',
    'class ApiClient',
  ]

  for (const snippet of expectedSnippets) {
    assert.match(
      code,
      new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `Expected ${filePath} to contain ${snippet}`,
    )
  }

  assert.doesNotMatch(
    code,
    /from\s+["']\.\/src|from\s+["']src\//,
    `Expected ${filePath} to be bundled and not reference src modules`,
  )
}

async function main(): Promise<void> {
  console.log('[e2e] clean example dist')
  cleanExampleDist()

  console.log('[e2e] build root package')
  await run('pnpm', ['build'])

  for (const example of examples) {
    console.log(`[e2e] build ${example.name} example`)
    await run('pnpm', ['--filter', example.filter, 'build'])

    for (const relativeFile of example.expectedFiles) {
      const filePath = path.join(example.dir, relativeFile)
      assertFileExists(filePath)
    }

    assertDtsContent(path.join(example.dir, 'dist/index.d.ts'))
  }

  console.log('[e2e] all examples passed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
