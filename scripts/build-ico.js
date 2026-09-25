'use strict';

const fs = require('fs');
const path = require('path');

const output = process.argv[2];
const inputs = process.argv.slice(3);
if (!output || !inputs.length) {
  console.error('Usage: node scripts/build-ico.js <output.ico> <size:path.png> [...]');
  process.exit(1);
}

const images = inputs.map((entry) => {
  const separator = entry.indexOf(':');
  const size = Number(entry.slice(0, separator));
  const file = entry.slice(separator + 1);
  if (!Number.isInteger(size) || size < 1 || size > 256 || !file) {
    throw new Error('Invalid icon entry: ' + entry);
  }
  const data = fs.readFileSync(file);
  if (data.length < 24 || data.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error('Icon entry is not a PNG: ' + file);
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== size || height !== size) {
    throw new Error(`Expected ${size}x${size}, got ${width}x${height}: ${file}`);
  }
  return { size, data };
});

const headerSize = 6 + images.length * 16;
const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

let offset = headerSize;
images.forEach((image, index) => {
  const entry = 6 + index * 16;
  header.writeUInt8(image.size === 256 ? 0 : image.size, entry);
  header.writeUInt8(image.size === 256 ? 0 : image.size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(image.data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += image.data.length;
});

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, Buffer.concat([header, ...images.map((image) => image.data)]));
console.log(`wrote ${output} (${images.map((image) => image.size).join(', ')}px)`);
