// Generates the toolbar / Web Store icons at 16/32/48/128 px.
//
// Design: solid navy square with three white horizontal bars — a minimal
// "document" glyph that stays legible at 16 px. Re-run with `npm run icons`
// after tweaking constants below.

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BG = [0x0f, 0x33, 0x54, 0xff] // navy
const FG = [0xff, 0xff, 0xff, 0xff] // white bars

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'icons')

// Three horizontal bars centered vertically, proportional to canvas size.
// All values are fractions of the canvas edge so they scale cleanly.
const PADDING_X = 0.18
const BAR_HEIGHT = 0.11
const BAR_GAP = 0.10
const BAR_LENGTHS = [1.0, 0.85, 0.72] // taper to suggest the end of an article

function pixel(x, y, n) {
  const padPx = Math.round(PADDING_X * n)
  const barH = Math.max(1, Math.round(BAR_HEIGHT * n))
  const gap = Math.max(1, Math.round(BAR_GAP * n))
  const block = 3 * barH + 2 * gap
  const top = Math.round((n - block) / 2)
  for (let i = 0; i < 3; i++) {
    const y0 = top + i * (barH + gap)
    if (y >= y0 && y < y0 + barH) {
      const usable = n - 2 * padPx
      const len = Math.max(1, Math.round(BAR_LENGTHS[i] * usable))
      if (x >= padPx && x < padPx + len) return FG
    }
  }
  return BG
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function makePng(n) {
  // RGBA scanlines with filter byte 0 (None) prepended to each row.
  const raw = Buffer.alloc(n * (1 + n * 4))
  for (let y = 0; y < n; y++) {
    let off = y * (1 + n * 4)
    raw[off++] = 0
    for (let x = 0; x < n; x++) {
      const [r, g, b, a] = pixel(x, y, n)
      raw[off++] = r
      raw[off++] = g
      raw[off++] = b
      raw[off++] = a
    }
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(n, 0)
  ihdr.writeUInt32BE(n, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const idat = deflateSync(raw)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

mkdirSync(OUT_DIR, { recursive: true })
for (const n of [16, 32, 48, 128]) {
  const path = join(OUT_DIR, `icon-${n}.png`)
  writeFileSync(path, makePng(n))
  console.log(`wrote ${path}`)
}
