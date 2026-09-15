// Écriture d'archives .zip sans dépendance (les navigateurs n'ont pas d'API zip).
// Utilisé pour produire des .xlsx (OOXML = zip de fichiers XML).
// - zipStoreSync : entrées non compressées (STORED), synchrone ;
// - zip          : compression DEFLATE via CompressionStream('deflate-raw') quand
//                  le navigateur la propose, sinon repli sur STORED.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

const textEnc = new TextEncoder()
const u16 = n => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF])
const u32 = n => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF])

export function concatBytes(arrs) {
  let len = 0
  for (const a of arrs) len += a.length
  const out = new Uint8Array(len)
  let o = 0
  for (const a of arrs) { out.set(a, o); o += a.length }
  return out
}
const toBytes = d => (typeof d === 'string' ? textEnc.encode(d) : d)

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

// entries: [{ name, raw: Uint8Array, data: Uint8Array, method: 0|8, crc }]
function assemble(entries) {
  const { time, day } = dosDateTime()
  const locals = [], central = []
  let offset = 0
  for (const e of entries) {
    const nameBytes = textEnc.encode(e.name)
    const header = concatBytes([
      u32(0x04034b50), u16(20), u16(0x0800), u16(e.method), u16(time), u16(day),
      u32(e.crc), u32(e.data.length), u32(e.raw.length),
      u16(nameBytes.length), u16(0), nameBytes,
    ])
    locals.push(header, e.data)
    central.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(e.method), u16(time), u16(day),
      u32(e.crc), u32(e.data.length), u32(e.raw.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset), nameBytes,
    ]))
    offset += header.length + e.data.length
  }
  const centralBytes = concatBytes(central)
  const eocd = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBytes.length), u32(offset), u16(0),
  ])
  return concatBytes([...locals, centralBytes, eocd])
}

// files: [{ name, data: string | Uint8Array }] → Uint8Array (zip valide, non compressé)
export function zipStoreSync(files) {
  return assemble(files.map(f => {
    const raw = toBytes(f.data)
    return { name: f.name, raw, data: raw, method: 0, crc: crc32(raw) }
  }))
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function zip(files, { compress = true } = {}) {
  const canDeflate = compress && typeof CompressionStream !== 'undefined'
  const entries = []
  for (const f of files) {
    const raw = toBytes(f.data)
    const crc = crc32(raw)
    let data = raw, method = 0
    if (canDeflate && raw.length > 256) {
      try { data = await deflateRaw(raw); method = 8 } catch { data = raw; method = 0 }
    }
    entries.push({ name: f.name, raw, data, method, crc })
  }
  return assemble(entries)
}
