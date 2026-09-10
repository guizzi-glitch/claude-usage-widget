"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const size = 256;
const outputDir = path.join(__dirname, "..", "windows", "assets");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return result;
}

function roundedRectDistance(x, y, inset, radius) {
  const centerX = Math.max(inset + radius, Math.min(size - inset - radius, x));
  const centerY = Math.max(inset + radius, Math.min(size - inset - radius, y));
  return Math.hypot(x - centerX, y - centerY) - radius;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function makePng() {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const index = y * (size * 4 + 1) + 1 + x * 4;
      const inside = roundedRectDistance(x + 0.5, y + 0.5, 8, 58) <= 0;
      const blend = (x + y) / (size * 2);
      let red = Math.round(56 * (1 - blend) + 20 * blend);
      let green = Math.round(189 * (1 - blend) + 184 * blend);
      let blue = Math.round(248 * (1 - blend) + 166 * blend);
      let alpha = inside ? 255 : 0;

      const top = Math.min(
        segmentDistance(x, y, 76, 69, 147, 69),
        segmentDistance(x, y, 147, 69, 186, 94),
        segmentDistance(x, y, 186, 94, 186, 125),
        segmentDistance(x, y, 186, 125, 147, 149),
        segmentDistance(x, y, 147, 149, 104, 149),
      );
      const bottom = Math.min(
        segmentDistance(x, y, 104, 149, 83, 163),
        segmentDistance(x, y, 83, 163, 83, 183),
        segmentDistance(x, y, 83, 183, 104, 197),
        segmentDistance(x, y, 104, 197, 180, 197),
      );
      if (inside && Math.min(top, bottom) <= 13.5) red = green = blue = 255;
      raw[index] = red;
      raw[index + 1] = green;
      raw[index + 2] = blue;
      raw[index + 3] = alpha;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

fs.mkdirSync(outputDir, { recursive: true });
const png = makePng();
fs.writeFileSync(path.join(outputDir, "icon.png"), png);

const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 0;
header[7] = 0;
header[8] = 0;
header[9] = 0;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(outputDir, "icon.ico"), Buffer.concat([header, png]));
