import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const ASSETS = Object.freeze([
  Object.freeze({
    name: 'wordmark',
    source: 'reference/asset-sources/logo.png',
    output: 'public/images/brand/lonelyyang3-wordmark.png',
    width: 2048,
    height: 682,
  }),
  Object.freeze({
    name: 'secondary',
    source: 'reference/asset-sources/bdinfo.png',
    output: 'public/images/brand/lonelyyang3-myself-world.png',
    width: 1829,
    height: 860,
  }),
])

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function validateAsset(buffer, mapping) {
  const image = sharp(buffer, { failOn: 'error' })
  const metadata = await image.metadata()
  assert(metadata.format === 'png', `${mapping.name}: source is not PNG`)
  assert(
    metadata.width === mapping.width && metadata.height === mapping.height,
    `${mapping.name}: dimensions do not match ${mapping.width}x${mapping.height}`,
  )
  assert(metadata.channels === 4 && metadata.hasAlpha === true, `${mapping.name}: source must be four-channel RGBA`)

  const decoded = await image.raw().toBuffer({ resolveWithObject: true })
  assert(decoded.info.channels === 4, `${mapping.name}: decoded source is not RGBA`)

  let transparent = 0
  let visible = 0
  for (let offset = 3; offset < decoded.data.length; offset += 4) {
    if (decoded.data[offset] === 0) {
      transparent += 1
    } else {
      visible += 1
    }
  }

  assert(transparent > 0, `${mapping.name}: source has no transparent pixels`)
  assert(visible > 0, `${mapping.name}: source has no visible pixels`)
  return { transparent, visible }
}

async function main() {
  const options = process.argv.slice(2)
  assert(
    options.length === 0 || (options.length === 1 && options[0] === '--check'),
    `Unknown option(s): ${options.join(' ') || '(none)'}`,
  )
  const checkOnly = options[0] === '--check'

  for (const mapping of ASSETS) {
    const source = await readFile(path.resolve(PROJECT_ROOT, mapping.source))
    const sourceStats = await validateAsset(source, mapping)
    const outputPath = path.resolve(PROJECT_ROOT, mapping.output)

    if (!checkOnly) {
      await writeFile(outputPath, source)
    }

    const runtime = await readFile(outputPath)
    const runtimeStats = await validateAsset(runtime, mapping)
    assert(runtime.equals(source), `${mapping.name}: runtime bytes differ from source`)
    console.log(
      `${checkOnly ? 'checked' : 'copied'} ${mapping.name}: transparent=${runtimeStats.transparent} visible=${runtimeStats.visible} source-visible=${sourceStats.visible}`,
    )
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`generate-brand-assets: ${message}`)
  process.exitCode = 1
})
