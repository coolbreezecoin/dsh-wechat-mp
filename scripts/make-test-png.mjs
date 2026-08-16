/**
 * Minimal dependency-free PNG encoder, used to generate test and demo imagery.
 *
 * Real image files are needed because WeChat validates format and size on upload,
 * and a checked-in binary would be dead weight in the repo.
 * @module
 */

import { deflateSync } from 'node:zlib'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/**
 * CRC-32 over a buffer, as PNG chunks require.
 * @param buf - bytes to checksum.
 * @returns the unsigned checksum.
 */
function crc32(buf) {
  let c = 0xFFFFFFFF
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

/**
 * Wrap payload bytes in a PNG chunk.
 * @param type - four-character chunk name.
 * @param data - chunk payload.
 * @returns the framed chunk.
 */
function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/**
 * Build a PNG with a soft diagonal gradient, so the result reads as a real image
 * rather than a flat block in a preview.
 * @param width - image width in pixels.
 * @param height - image height in pixels.
 * @param rgb - base colour as `[r, g, b]`.
 * @returns the encoded PNG.
 */
export function makePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (width * 3 + 1))
  let offset = 0
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const t = (x / Math.max(1, width - 1) + y / Math.max(1, height - 1)) / 2
      const shade = 0.6 + 0.4 * t
      raw[offset++] = Math.round(rgb[0] * shade)
      raw[offset++] = Math.round(rgb[1] * shade)
      raw[offset++] = Math.round(rgb[2] * shade)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
