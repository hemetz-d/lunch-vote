// Builds lunch-vote-teams.zip from the files under teams/.
// Upload the resulting zip at https://dev.teams.microsoft.com/apps (Import app).
//
// Pure-Node zip writer — "stored" method (no compression). The files involved
// are a JSON manifest and two small PNGs, so skipping deflate keeps this
// script under 100 lines and dependency-free.
//
// Run with:  node scripts/build-teams-zip.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "lunch-vote-teams.zip");

const FILES = [
  { zipPath: "manifest.json",      diskPath: join(ROOT, "teams", "manifest.json") },
  { zipPath: "icons/color.png",    diskPath: join(ROOT, "teams", "icons", "color.png") },
  { zipPath: "icons/outline.png",  diskPath: join(ROOT, "teams", "icons", "outline.png") },
];

// -- CRC32 (same polynomial as zip + PNG) --
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const chunks = [];
const centralEntries = [];
let offset = 0;

for (const f of FILES) {
  const data = readFileSync(f.diskPath);
  const nameBuf = Buffer.from(f.zipPath, "utf8");
  const crc = crc32(data);

  // Local file header
  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50, 0);     // signature
  local.writeUInt16LE(20, 4);             // version needed
  local.writeUInt16LE(0, 6);              // flags
  local.writeUInt16LE(0, 8);              // method: stored
  local.writeUInt16LE(0, 10);             // mod time
  local.writeUInt16LE(0x21, 12);          // mod date (Jan 1, 1980)
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);   // compressed size
  local.writeUInt32LE(data.length, 22);   // uncompressed size
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);             // extra field length
  nameBuf.copy(local, 30);

  chunks.push(local, data);

  // Central directory entry
  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0);   // signature
  central.writeUInt16LE(20, 4);           // version made by
  central.writeUInt16LE(20, 6);           // version needed
  central.writeUInt16LE(0, 8);            // flags
  central.writeUInt16LE(0, 10);           // method
  central.writeUInt16LE(0, 12);           // mod time
  central.writeUInt16LE(0x21, 14);        // mod date
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);           // extra length
  central.writeUInt16LE(0, 32);           // comment length
  central.writeUInt16LE(0, 34);           // disk number
  central.writeUInt16LE(0, 36);           // internal attrs
  central.writeUInt32LE(0, 38);           // external attrs
  central.writeUInt32LE(offset, 42);      // local header offset
  nameBuf.copy(central, 46);
  centralEntries.push(central);

  offset += local.length + data.length;
}

const cdStart = offset;
for (const c of centralEntries) chunks.push(c);
const cdSize = centralEntries.reduce((s, c) => s + c.length, 0);

// End of central directory
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);                 // disk number
eocd.writeUInt16LE(0, 6);                 // disk with CD
eocd.writeUInt16LE(FILES.length, 8);      // CD entries on this disk
eocd.writeUInt16LE(FILES.length, 10);     // total CD entries
eocd.writeUInt32LE(cdSize, 12);
eocd.writeUInt32LE(cdStart, 16);
eocd.writeUInt16LE(0, 20);                // comment length
chunks.push(eocd);

writeFileSync(OUT, Buffer.concat(chunks));
console.log(`wrote ${OUT} (${FILES.length} files)`);
