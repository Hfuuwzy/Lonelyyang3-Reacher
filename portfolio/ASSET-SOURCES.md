# Asset Sources

This document covers the user-provided source files under `reference/asset-sources/` and their documented runtime derivatives only. Webpages load local runtime files from `public/images/` via `/images/...`; they do not directly load files from `reference/asset-sources/`. This is not an inventory of every file under `public/`.

## Homepage hero asset

| Source | Source properties | Runtime derivative | Use |
|---|---|---|---|
| `reference/asset-sources/kv2.png` | `1920×2566`; transparent RGBA | `public/images/home/hero-main.png`; byte-for-byte copy at unchanged `1920×2566` | Homepage loading artwork and normal-flow hero image |

The hero source is user-provided/generated and copied without resizing or re-encoding. The source and runtime file must remain byte-identical.

## Homepage brand assets

| Source | Source properties | Runtime derivative | Use |
|---|---|---|---|
| `reference/asset-sources/logo.png` | `2048×682`; transparent RGBA | `public/images/brand/lonelyyang3-wordmark.png`; byte-for-byte copy at unchanged `2048×682` | Main homepage brush wordmark |
| `reference/asset-sources/bdinfo.png` | `1829×860`; transparent RGBA | `public/images/brand/lonelyyang3-myself-world.png`; byte-for-byte copy at unchanged `1829×860` | Secondary bilingual brand artwork |

For these two listed source images, the user supplied the rights and provenance information; they remain preserved and untouched. `scripts/generate-brand-assets.mjs` validates their PNG format, RGBA channels, dimensions, visible pixels, and transparent pixels, then copies the encoded bytes unchanged to the runtime paths. Generate or verify with:

```text
node scripts/generate-brand-assets.mjs
node scripts/generate-brand-assets.mjs --check
```

No matte removal or re-encoding is applied. This preserves the supplied alpha channel, colors, antialiased brush edges, and encoded PNG bytes exactly; `--check` also requires each runtime file to be byte-identical to its source.

No per-slice, cropped, dark-theme, or other raster variants may be created, except for the user-supplied homepage loading pieces below and their deterministic runtime derivatives. Slicing and the secondary crop remain CSS-only. No reference-site logo, image, or other proprietary asset is used as a source for the user-provided assets documented in this file or their derivatives.

## Homepage loading intro and site icon

| Source | Source properties | Runtime derivative | Use |
|---|---|---|---|
| `reference/asset-sources/logo01-lonely-clean.png` | user-owned transparent RGBA with alpha; pre-positioned `724×2172` canvas | `public/images/brand/home-intro/logo01-lonely-clean.png`; byte-for-byte copy at unchanged `724×2172` | Loading-logo `lonely` layer |
| `reference/asset-sources/logo02-yang-clean.png` | user-owned transparent RGBA with alpha; pre-positioned `724×2172` canvas | `public/images/brand/home-intro/logo02-yang-clean.png`; byte-for-byte copy at unchanged `724×2172` | Loading-logo `yang` layer |
| `reference/asset-sources/logo03-3.png` | user-owned transparent RGBA with alpha; pre-positioned `724×2172` canvas | `public/images/brand/home-intro/logo03-3.png`; byte-for-byte copy at unchanged `724×2172` | Loading-logo `3` layer |
| `reference/asset-sources/logo04-icon.png` | user-owned transparent RGBA with alpha; pre-positioned `724×2172` canvas | `public/images/brand/home-intro/logo04-icon.png`; byte-for-byte copy at unchanged `724×2172` | Loading-logo coral icon layer |
| `reference/asset-sources/logo05-wordmark.png` | user-owned transparent RGBA with alpha; pre-positioned `724×2172` canvas | `public/images/brand/home-intro/logo05-wordmark.png`; byte-for-byte copy at unchanged `724×2172` | Loading-logo vertical `LONELYYANG3` wordmark layer |
| `reference/asset-sources/图标.png` | user-owned opaque three-channel RGB, no alpha; white-matted PNG; `1254×1254` | `public/images/brand/site-icon.png`; transparent RGBA `1254×1254` | Site icon |

Generate these files with local Sharp and Node standard-library APIs only:

```text
node scripts/generate-home-intro-assets.mjs
```

`scripts/generate-home-intro-assets.mjs` copies all five loading-intro sources byte-for-byte to their matching runtime paths. Their existing alpha, `724×2172` dimensions, pre-positioned coordinates, and encoded PNG bytes remain unchanged; the generator does not transform, crop, resize, reposition, unmatte, re-encode, or otherwise process them.

The separate `reference/asset-sources/图标.png` source retains its transparent-generation path: bright neutral matte pixels are cleared first; remaining near-white edge pixels use `distance = max(255-r, 255-g, 255-b)` to receive linearly scaled alpha and per-channel white unmatting, while clearly non-white foreground pixels retain their original RGB and full opacity. Its encoded `public/images/brand/site-icon.png` derivative uses compression level 9, adaptive filtering, no palette, and non-progressive output.

The six source files in the homepage loading intro and site icon section are user-owned and remain untouched. This document describes only those listed sources and their documented derivatives; the separate [`public/images/reference/deaimon/ASSET-SOURCES.md`](public/images/reference/deaimon/ASSET-SOURCES.md) records the local development-preview placeholders in that directory and their source URL metadata.
