import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'

const sizes = [16, 32, 48, 128, 512]
const scale = 4

const colors = {
  paper: [50, 67, 98, 255],
  white: [255, 255, 255, 255],
  line: [190, 204, 222, 255],
  blueSoft: [244, 248, 252, 255],
  cyanSoft: [222, 242, 244, 255],
  blueStroke: [198, 211, 229, 255],
  cyanStroke: [156, 202, 208, 255],
  ink: [32, 43, 64, 235],
  blue: [87, 116, 159, 255],
  cyan: [92, 175, 184, 255]
}

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable[n] = c >>> 0
}

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function blend(buffer, width, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= width || y >= width || alpha <= 0) return
  const index = (y * width + x) * 4
  const sourceAlpha = (color[3] / 255) * alpha
  const targetAlpha = buffer[index + 3] / 255
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha)
  if (outAlpha <= 0) return

  for (let i = 0; i < 3; i += 1) {
    buffer[index + i] = Math.round(
      (color[i] * sourceAlpha + buffer[index + i] * targetAlpha * (1 - sourceAlpha)) / outAlpha
    )
  }
  buffer[index + 3] = Math.round(outAlpha * 255)
}

function fillRoundedRect(buffer, width, x, y, w, h, r, color) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.ceil(x + w)
  const y1 = Math.ceil(y + h)

  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const cx = px + 0.5
      const cy = py + 0.5
      const dx = Math.max(x + r - cx, 0, cx - (x + w - r))
      const dy = Math.max(y + r - cy, 0, cy - (y + h - r))
      if (dx * dx + dy * dy <= r * r) blend(buffer, width, px, py, color)
    }
  }
}

function strokeRoundedRect(buffer, width, x, y, w, h, r, stroke, color) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.ceil(x + w)
  const y1 = Math.ceil(y + h)
  const innerX = x + stroke
  const innerY = y + stroke
  const innerW = w - stroke * 2
  const innerH = h - stroke * 2
  const innerR = Math.max(0, r - stroke)

  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const cx = px + 0.5
      const cy = py + 0.5
      const outerDx = Math.max(x + r - cx, 0, cx - (x + w - r))
      const outerDy = Math.max(y + r - cy, 0, cy - (y + h - r))
      const innerDx = Math.max(innerX + innerR - cx, 0, cx - (innerX + innerW - innerR))
      const innerDy = Math.max(innerY + innerR - cy, 0, cy - (innerY + innerH - innerR))
      const inOuter = outerDx * outerDx + outerDy * outerDy <= r * r
      const inInner = innerDx * innerDx + innerDy * innerDy <= innerR * innerR
      if (inOuter && !inInner) blend(buffer, width, px, py, color)
    }
  }
}

function line(buffer, width, x1, y1, x2, y2, stroke, color) {
  const minX = Math.floor(Math.min(x1, x2) - stroke)
  const maxX = Math.ceil(Math.max(x1, x2) + stroke)
  const minY = Math.floor(Math.min(y1, y2) - stroke)
  const maxY = Math.ceil(Math.max(y1, y2) + stroke)
  const vx = x2 - x1
  const vy = y2 - y1
  const len2 = vx * vx + vy * vy

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const cx = px + 0.5
      const cy = py + 0.5
      const t = Math.max(0, Math.min(1, ((cx - x1) * vx + (cy - y1) * vy) / len2))
      const dx = cx - (x1 + vx * t)
      const dy = cy - (y1 + vy * t)
      if (Math.sqrt(dx * dx + dy * dy) <= stroke / 2) blend(buffer, width, px, py, color)
    }
  }
}

function circle(buffer, width, cx, cy, radius, color) {
  const x0 = Math.floor(cx - radius)
  const y0 = Math.floor(cy - radius)
  const x1 = Math.ceil(cx + radius)
  const y1 = Math.ceil(cy + radius)
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const dx = px + 0.5 - cx
      const dy = py + 0.5 - cy
      if (dx * dx + dy * dy <= radius * radius) blend(buffer, width, px, py, color)
    }
  }
}

function rect(buffer, width, x, y, w, h, color) {
  for (let py = Math.floor(y); py < Math.ceil(y + h); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px += 1) {
      blend(buffer, width, px, py, color)
    }
  }
}

function downsample(source, large, small) {
  const out = Buffer.alloc(small * small * 4)
  for (let y = 0; y < small; y += 1) {
    for (let x = 0; x < small; x += 1) {
      const sums = [0, 0, 0, 0]
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const index = ((y * scale + sy) * large + (x * scale + sx)) * 4
          for (let i = 0; i < 4; i += 1) sums[i] += source[index + i]
        }
      }
      const target = (y * small + x) * 4
      for (let i = 0; i < 4; i += 1) out[target + i] = Math.round(sums[i] / (scale * scale))
    }
  }
  return out
}

function draw(size) {
  const width = size * scale
  const u = width / 512
  const buffer = Buffer.alloc(width * width * 4)

  fillRoundedRect(buffer, width, 0, 0, width, width, 112 * u, colors.paper)
  fillRoundedRect(buffer, width, 58 * u, 78 * u, 396 * u, 356 * u, 88 * u, [58, 78, 115, 255])
  fillRoundedRect(buffer, width, 104 * u, 136 * u, 168 * u, 236 * u, 36 * u, colors.blueSoft)
  fillRoundedRect(buffer, width, 224 * u, 136 * u, 184 * u, 236 * u, 36 * u, colors.cyanSoft)
  strokeRoundedRect(buffer, width, 104 * u, 136 * u, 168 * u, 236 * u, 36 * u, 14 * u, colors.blueStroke)
  strokeRoundedRect(buffer, width, 224 * u, 136 * u, 184 * u, 236 * u, 36 * u, 14 * u, colors.cyanStroke)
  rect(buffer, width, 248 * u, 152 * u, 28 * u, 204 * u, colors.cyanSoft)
  line(buffer, width, 152 * u, 250 * u, 242 * u, 250 * u, 24 * u, colors.ink)
  line(buffer, width, 197 * u, 194 * u, 197 * u, 318 * u, 24 * u, colors.ink)
  line(buffer, width, 286 * u, 250 * u, 362 * u, 250 * u, 24 * u, colors.white)
  line(buffer, width, 286 * u, 250 * u, 362 * u, 250 * u, 14 * u, colors.blue)
  circle(buffer, width, 348 * u, 198 * u, 34 * u, colors.cyan)
  circle(buffer, width, 348 * u, 198 * u, 16 * u, colors.white)
  circle(buffer, width, 348 * u, 198 * u, 9 * u, colors.cyan)

  return downsample(buffer, width, size)
}

for (const size of sizes) {
  writeFileSync(`public/icons/icon_${size}.png`, encodePng(size, size, draw(size)))
}
