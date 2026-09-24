import { copyFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SOURCE_DIRECTORY = path.join(PROJECT_ROOT, 'reference', 'asset-sources')
const BRAND_DIRECTORY = path.join(PROJECT_ROOT, 'public', 'images', 'brand')
const INTRO_DIRECTORY = path.join(BRAND_DIRECTORY, 'home-intro')
const WIDTH = 724
const HEIGHT = 2172

const LAYERS = Object.freeze([
  'logo01-lonely-clean.png',
  'logo02-yang-clean.png',
  'logo03-3.png',
  'logo04-icon.png',
  'logo05-wordmark.png',
].map((filename) => Object.freeze({
  filename,
  source: path.join(SOURCE_DIRECTORY, filename),
  output: path.join(INTRO_DIRECTORY, filename),
})))

const SITE_ICON = Object.freeze({
  source: path.join(SOURCE_DIRECTORY, '图标.png'),
  output: path.join(BRAND_DIRECTORY, 'site-icon.png'),
  width: 1254,
  height: 1254,
})

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function validateLayer(layer) {
  const image = sharp(layer.source, { failOn: 'error' })
  const metadata = await image.metadata()
  assert(metadata.format === 'png', `${layer.filename}: source is not PNG`)
  assert(metadata.width === WIDTH && metadata.height === HEIGHT, `${layer.filename}: expected ${WIDTH}x${HEIGHT}`)
  assert(metadata.channels === 4 && metadata.hasAlpha === true, `${layer.filename}: source must be RGBA`)

  const decoded = await image.raw().toBuffer({ resolveWithObject: true })
  const corners = [0, WIDTH - 1, WIDTH * (HEIGHT - 1), WIDTH * HEIGHT - 1]
  for (const pixel of corners) {
    assert(decoded.data[pixel * 4 + 3] === 0, `${layer.filename}: corner ${pixel} is not transparent`)
  }
  assert(decoded.data.some((value, index) => index % 4 === 3 && value > 0), `${layer.filename}: layer has no visible pixels`)
}

function unmatteChannel(channel, alpha) {
  return Math.max(0, Math.min(255, Math.round(((channel - (255 - alpha)) * 255) / alpha)))
}

function removeIconMatte(pixels) {
  const rgba = Buffer.alloc(SITE_ICON.width * SITE_ICON.height * 4)
  for (let pixel = 0; pixel < SITE_ICON.width * SITE_ICON.height; pixel += 1) {
    const inputOffset = pixel * 3
    const outputOffset = pixel * 4
    const red = pixels[inputOffset]
    const green = pixels[inputOffset + 1]
    const blue = pixels[inputOffset + 2]
    const distance = Math.max(255 - red, 255 - green, 255 - blue)
    if (distance <= 3) {
      continue
    }
    if (distance >= 48) {
      rgba[outputOffset] = red
      rgba[outputOffset + 1] = green
      rgba[outputOffset + 2] = blue
      rgba[outputOffset + 3] = 255
      continue
    }
    const alpha = Math.round(((distance - 3) * 255) / 45)
    rgba[outputOffset] = unmatteChannel(red, alpha)
    rgba[outputOffset + 1] = unmatteChannel(green, alpha)
    rgba[outputOffset + 2] = unmatteChannel(blue, alpha)
    rgba[outputOffset + 3] = alpha
  }
  return rgba
}

async function generateSiteIcon() {
  const image = sharp(SITE_ICON.source, { failOn: 'error' })
  const metadata = await image.metadata()
  assert(metadata.format === 'png', 'site-icon: source is not PNG')
  assert(metadata.width === SITE_ICON.width && metadata.height === SITE_ICON.height, 'site-icon: source dimensions changed')
  assert(metadata.channels === 3 && metadata.hasAlpha === false, 'site-icon: source must be opaque RGB')
  const decoded = await image.raw().toBuffer({ resolveWithObject: true })
  const rgba = removeIconMatte(decoded.data)
  await sharp(rgba, { raw: { width: SITE_ICON.width, height: SITE_ICON.height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, progressive: false })
    .toFile(SITE_ICON.output)
}

async function main() {
  await mkdir(INTRO_DIRECTORY, { recursive: true })
  for (let index = 1; index <= 11; index += 1) {
    await rm(path.join(INTRO_DIRECTORY, `logo${String(index).padStart(2, '0')}.png`), { force: true })
  }
  for (const layer of LAYERS) {
    await validateLayer(layer)
    await copyFile(layer.source, layer.output)
    console.log(`copied ${path.relative(PROJECT_ROOT, layer.output)} ${WIDTH}x${HEIGHT}`)
  }
  await generateSiteIcon()
  console.log(`generated ${path.relative(PROJECT_ROOT, SITE_ICON.output)} ${SITE_ICON.width}x${SITE_ICON.height}`)
}

await main()
