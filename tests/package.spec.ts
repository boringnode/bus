/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, rm, symlink, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'

/**
 * Builds the package and installs it in a consumer project outside of
 * this repository, with only the runtime dependencies available. It
 * mirrors what `npm install @boringnode/bus` gives to a user.
 */
test.group('Package', (group) => {
  let consumer: string

  group.setup(async () => {
    execFileSync('yarn', ['build'], { stdio: 'ignore' })

    consumer = await mkdtemp(join(tmpdir(), 'bus-consumer-'))
    const pkg = join(consumer, 'node_modules/@boringnode/bus')
    await mkdir(pkg, { recursive: true })
    await cp('build', join(pkg, 'build'), { recursive: true })
    await cp('package.json', join(pkg, 'package.json'))

    for (const dependency of [
      '@paralleldrive/cuid2',
      '@poppinss/utils',
      'object-hash',
      '@types/node',
    ]) {
      await mkdir(join(consumer, 'node_modules', dependency, '..'), { recursive: true })
      await symlink(
        join(process.cwd(), 'node_modules', dependency),
        join(consumer, 'node_modules', dependency)
      )
    }

    return () => rm(consumer, { recursive: true, force: true })
  })

  test('import the test helpers entrypoint', async ({ assert }) => {
    const output = execFileSync(
      'node',
      [
        '--input-type=module',
        '-e',
        `const { ChaosTransport } = await import('@boringnode/bus/test_helpers'); console.log(typeof ChaosTransport)`,
      ],
      { cwd: consumer, encoding: 'utf8' }
    )

    assert.equal(output.trim(), 'function')
  }).timeout(30_000)

  test('type-check the core entrypoints without ioredis and mqtt installed', async ({ assert }) => {
    await writeFile(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: ['node'],
        },
        files: ['index.ts'],
      })
    )
    await writeFile(
      join(consumer, 'index.ts'),
      [
        `import { Bus, BusManager } from '@boringnode/bus'`,
        `import { memory } from '@boringnode/bus/transports/memory'`,
        `import type { Transport } from '@boringnode/bus/types/core'`,
        `export const manager = new BusManager({ transports: { main: { transport: memory() } } })`,
        `export const bus: Bus = manager.use('main')`,
        `export type T = Transport`,
      ].join('\n')
    )

    const tsc = join(process.cwd(), 'node_modules/typescript/bin/tsc')
    const result = (() => {
      try {
        return execFileSync('node', [tsc, '-p', consumer], { encoding: 'utf8' })
      } catch (error) {
        return error.stdout as string
      }
    })()

    assert.equal(result.trim(), '')
  }).timeout(30_000)
})
