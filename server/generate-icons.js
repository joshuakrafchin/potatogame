// Generates minimal valid PNG icons (solid green with "HP" text)
// We use a raw PNG encoder (no dependencies)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(size) {
  const w = size, h = size;
  // RGBA raw data
  const raw = Buffer.alloc(h * (1 + w * 4)); // filter byte + pixels per row
  for (let y = 0; y < h; y++) {
    const rowOff = y * (1 + w * 4);
    raw[rowOff] = 0; // no filter
    for (let x = 0; x < w; x++) {
      const off = rowOff + 1 + x * 4;
      // Green background
      let r = 74, g = 140, b = 63, a = 255;
      // Draw a simple potato shape (circle in center)
      const cx = w / 2, cy = h / 2, radius = w * 0.3;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < radius) {
        // Potato brown
        r = 201; g = 168; b = 76;
        // Lighter center
        if (dist < radius * 0.6) { r = 245; g = 230; b = 184; }
      }
      // Orange glow around potato
      if (dist >= radius && dist < radius * 1.3) {
        const t = (dist - radius) / (radius * 0.3);
        r = Math.floor(r + (255 - r) * (1 - t) * 0.5);
        g = Math.floor(g + (140 - g) * (1 - t) * 0.5);
        b = Math.floor(b + (66 - b) * (1 - t) * 0.5);
      }
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }

  const deflated = zlib.deflateSync(raw);

  // Build PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type);
    const crcData = Buffer.concat([typeB, data]);
    const crc = Buffer.alloc(4); crc.writeInt32BE(crc32(crcData));
    return Buffer.concat([len, typeB, data, crc]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', deflated);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// CRC32
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) | 0;
}

fs.writeFileSync(path.join(__dirname, 'public', 'icon-192.png'), createPNG(192));
fs.writeFileSync(path.join(__dirname, 'public', 'icon-512.png'), createPNG(512));
console.log('Icons generated!');
