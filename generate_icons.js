const fs = require('fs');
const path = require('path');

// Simple script to generate clean PNG icons for the extension using pure Node.js (canvas-less PNG generator)
function createMinimalPNG(width, height, r, g, b) {
  // A simple solid color PNG binary buffer generator
  const zlib = require('zlib');
  
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // Bit depth
  ihdr.writeUInt8(6, 9); // Color type (RGBA)
  ihdr.writeUInt8(0, 10); // Compression
  ihdr.writeUInt8(0, 11); // Filter
  ihdr.writeUInt8(0, 12); // Interlace
  const ihdrChunk = createChunk('IHDR', ihdr);

  // Raw pixel data: 1 byte filter (0) per scanline + width * 4 bytes (RGBA)
  const lineSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * lineSize);
  
  for (let y = 0; y < height; y++) {
    const lineOffset = y * lineSize;
    rawData[lineOffset] = 0; // None filter
    for (let x = 0; x < width; x++) {
      const pixelOffset = lineOffset + 1 + x * 4;
      // Gradient / solid styling
      const factor = (x + y) / (width + height);
      rawData[pixelOffset] = Math.round(r * (1 - factor * 0.3));     // Red
      rawData[pixelOffset + 1] = Math.round(g * (1 - factor * 0.1)); // Green
      rawData[pixelOffset + 2] = Math.round(b + factor * 50);        // Blue
      rawData[pixelOffset + 3] = 255;                                // Alpha
    }
  }
  
  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);
  
  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Table for CRC-32
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

fs.writeFileSync(path.join(iconsDir, 'icon16.png'), createMinimalPNG(16, 16, 99, 102, 241));
fs.writeFileSync(path.join(iconsDir, 'icon48.png'), createMinimalPNG(48, 48, 99, 102, 241));
fs.writeFileSync(path.join(iconsDir, 'icon128.png'), createMinimalPNG(128, 128, 99, 102, 241));

console.log('Successfully generated icons!');
