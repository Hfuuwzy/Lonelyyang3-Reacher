import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { z } from 'zod'

const PINNED_VERSION = '0.1.7-rc.2'

export function verifyPinnedDsh(): string {
  const packageJson = z.object({ dependencies: z.record(z.string(), z.string()).optional() })
    .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')))
  const installed = z.object({ version: z.string() })
    .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh-sdk-client', 'package.json'), 'utf8')))
  const cliPackagePath = createRequire(resolve(process.cwd(), 'package.json')).resolve('@deepseek-ai/dsh/package.json')
  const cliPackage = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(cliPackagePath, 'utf8')))
  if (packageJson.dependencies?.['@deepseek-ai/dsh-sdk-client'] !== PINNED_VERSION
    || installed.version !== PINNED_VERSION || cliPackage.version !== PINNED_VERSION) {
    throw new Error('paper task requires the pinned DSH 0.1.7-rc.2 client and CLI')
  }
  const cliPath = resolve(process.cwd(), '..', 'harness', 'apps', 'cli', 'lib', 'bin.js')
  const version = spawnSync(process.execPath, [cliPath, '--version'], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
  })
  if (version.status !== 0 || version.stdout.trim() !== PINNED_VERSION) {
    throw new Error('paper task requires the pinned DSH 0.1.7-rc.2 CLI build')
  }
  return cliPath
}
