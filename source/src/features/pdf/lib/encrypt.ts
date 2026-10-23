/**
 * PDF 加密（ISO 32000-2 標準安全處理常式，V5／R6，AES-256）。
 * pdf-lib 不支援加密，這裡自己實作：
 * 1. 以 pdf-lib 載入並重新存成「不使用物件串流」的檔案，再載入一次，讓所有串流都變成已編碼的原始位元組；
 * 2. 走訪每個間接物件，把字串與串流內容以檔案金鑰做 AES-256-CBC 加密（隨機 IV 置於開頭，PKCS#7 補位）；
 * 3. 加入 /Encrypt 字典（不加密）與 /ID，交由 pdf-lib 寫出。
 * 密碼雜湊使用演算法 2.B（SHA-256／384／512 交替＋AES-128-CBC），全部透過 Web Crypto 完成。
 */
import type { PDFDict, PDFDocument, PDFObject, PDFRef } from 'pdf-lib'
import { loadForEdit } from './ops'

export interface Permissions {
  print: boolean
  printHigh: boolean
  modify: boolean
  copy: boolean
  annotate: boolean
  fillForms: boolean
  assemble: boolean
  accessibility: boolean
}

export const ALL_PERMISSIONS: Permissions = {
  print: true,
  printHigh: true,
  modify: true,
  copy: true,
  annotate: true,
  fillForms: true,
  assemble: true,
  accessibility: true,
}

export interface EncryptOptions {
  /** 開啟密碼（可空：任何人可開啟，但權限受限） */
  userPassword: string
  /** 權限密碼（空時自動產生隨機密碼） */
  ownerPassword: string
  permissions: Permissions
  encryptMetadata?: boolean
}

const subtle = () => globalThis.crypto.subtle
const enc = new TextEncoder()

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))

/** 密碼：Unicode 正規化（SASLprep 的主要部分）後取 UTF-8 前 127 位元組 */
export function passwordBytes(pw: string): Uint8Array {
  return enc.encode(pw.normalize('NFKC')).slice(0, 127)
}

const buf = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>

async function digest(alg: 'SHA-256' | 'SHA-384' | 'SHA-512', data: Uint8Array) {
  return new Uint8Array(await subtle().digest(alg, buf(data)))
}

/** AES-CBC 加密（Web Crypto 一律補 PKCS#7；noPad 時去掉最後補上的整個區塊） */
async function aesCbc(key: Uint8Array, iv: Uint8Array, data: Uint8Array, noPad = false) {
  const k = await subtle().importKey('raw', buf(key), { name: 'AES-CBC' }, false, ['encrypt'])
  const out = new Uint8Array(
    await subtle().encrypt({ name: 'AES-CBC', iv: buf(iv) }, k, buf(data)),
  )
  return noPad ? out.slice(0, data.length) : out
}

/** 演算法 2.B：R6 的密碼雜湊 */
export async function hash2B(pw: Uint8Array, salt: Uint8Array, udata: Uint8Array) {
  let K = await digest('SHA-256', concat(pw, salt, udata))
  for (let i = 0; ; i++) {
    const block = concat(pw, K, udata)
    const K1 = new Uint8Array(block.length * 64)
    for (let j = 0; j < 64; j++) K1.set(block, j * block.length)
    const E = await aesCbc(K.slice(0, 16), K.slice(16, 32), K1, true)
    let sum = 0
    for (let j = 0; j < 16; j++) sum += E[j]
    const alg = (['SHA-256', 'SHA-384', 'SHA-512'] as const)[sum % 3]
    K = await digest(alg, E)
    // 規範的輪數從 1 起算（i＋1）：第 64 輪起，最後一個位元組 ≤ 輪數－32 才停
    if (i + 1 >= 64 && E[E.length - 1] <= i + 1 - 32) break
  }
  return K.slice(0, 32)
}

/** 權限旗標 P（32 位元有號整數；保留位元依規範設為 1） */
export function permissionBits(p: Permissions): number {
  let bits = 0xfffff0c0 // 位元 7、8、13–32 為 1；1、2 為 0
  if (p.print) bits |= 1 << 2
  if (p.modify) bits |= 1 << 3
  if (p.copy) bits |= 1 << 4
  if (p.annotate) bits |= 1 << 5
  if (p.fillForms) bits |= 1 << 8
  if (p.accessibility) bits |= 1 << 9
  if (p.assemble) bits |= 1 << 10
  if (p.print && p.printHigh) bits |= 1 << 11
  return bits | 0
}

export interface SecurityHandler {
  fileKey: Uint8Array
  O: Uint8Array
  U: Uint8Array
  OE: Uint8Array
  UE: Uint8Array
  Perms: Uint8Array
  P: number
}

/** 演算法 8、9、10：產生 U／UE、O／OE 與 Perms */
export async function makeSecurityHandler(o: EncryptOptions): Promise<SecurityHandler> {
  const fileKey = random(32)
  const zeroIv = new Uint8Array(16)
  const upw = passwordBytes(o.userPassword)
  const opw = passwordBytes(o.ownerPassword || bytesToHex(random(16)))

  const uvs = random(8)
  const uks = random(8)
  const U = concat(await hash2B(upw, uvs, new Uint8Array(0)), uvs, uks)
  const UE = await aesCbc(await hash2B(upw, uks, new Uint8Array(0)), zeroIv, fileKey, true)

  const ovs = random(8)
  const oks = random(8)
  const O = concat(await hash2B(opw, ovs, U), ovs, oks)
  const OE = await aesCbc(await hash2B(opw, oks, U), zeroIv, fileKey, true)

  const P = permissionBits(o.permissions)
  const perms = new Uint8Array(16)
  new DataView(perms.buffer).setInt32(0, P, true)
  perms.set([0xff, 0xff, 0xff, 0xff], 4)
  perms[8] = (o.encryptMetadata ?? true) ? 0x54 /* T */ : 0x46 /* F */
  perms.set([0x61, 0x64, 0x62], 9) // 'adb'
  perms.set(random(4), 12)
  // AES-256-ECB 單一區塊＝零 IV 的 CBC 第一個區塊
  const Perms = (await aesCbc(fileKey, zeroIv, perms)).slice(0, 16)
  return { fileKey, O, U, OE, UE, Perms, P }
}

const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** 以檔案金鑰加密一段資料（AESV3：隨機 16 位元組 IV＋密文） */
async function encryptData(key: CryptoKey, data: Uint8Array) {
  const iv = random(16)
  const out = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, key, buf(data)))
  return concat(iv, out)
}

/**
 * 加密整份文件。回傳新的 PDF 位元組。
 * 已有數位簽章的文件加密後簽章會失效（介面已提示）。
 */
export async function encryptPdf(
  bytes: Uint8Array,
  opts: EncryptOptions,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const lib = await import('pdf-lib')
  const { PDFDocument, PDFName, PDFNumber, PDFHexString, PDFString, PDFDict, PDFArray, PDFRawStream, PDFStream, PDFBool } =
    lib
  // 1. 重新存成沒有物件串流的檔案，讓每個物件都能單獨加密
  const first = await loadForEdit(bytes)
  const flat = await first.save({ useObjectStreams: false, addDefaultPage: false })
  const doc: PDFDocument = await PDFDocument.load(flat, { updateMetadata: false })
  const ctx = doc.context

  const sec = await makeSecurityHandler(opts)
  const key = await subtle().importKey('raw', buf(sec.fileKey), { name: 'AES-CBC' }, false, [
    'encrypt',
  ])
  const encryptMeta = opts.encryptMetadata ?? true

  const encStr = async (o: PDFObject) => {
    if (o instanceof PDFString || o instanceof PDFHexString) {
      return PDFHexString.of(bytesToHex(await encryptData(key, o.asBytes())))
    }
    return null
  }

  /** 遞迴加密字典與陣列中的直接字串 */
  const walk = async (o: PDFObject): Promise<PDFObject | null> => {
    const s = await encStr(o)
    if (s) return s
    if (o instanceof PDFDict) {
      for (const [k, v] of o.entries()) {
        const n = await walk(v)
        if (n) o.set(k, n)
      }
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) {
        const n = await walk(o.get(i))
        if (n) o.set(i, n)
      }
    }
    return null
  }

  const objects = ctx.enumerateIndirectObjects()
  let done = 0
  for (const [ref, obj] of objects) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (obj instanceof PDFStream) {
      const dict = obj.dict
      const type = dict.get(PDFName.of('Type'))
      const isXref = type === PDFName.of('XRef')
      const isMeta = type === PDFName.of('Metadata')
      await walk(dict)
      if (!isXref && (encryptMeta || !isMeta)) {
        const raw = obj instanceof PDFRawStream ? obj.contents : obj.getContents()
        const data = await encryptData(key, raw)
        const next = PDFRawStream.of(dict, data)
        ctx.assign(ref as PDFRef, next)
      }
    } else {
      const n = await walk(obj)
      if (n) ctx.assign(ref as PDFRef, n)
    }
    done++
    if (done % 50 === 0) {
      onProgress?.(done / objects.length)
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  // 2. 加密字典（本身不加密）
  const cf = ctx.obj({
    StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 },
  }) as PDFDict
  const encDict = ctx.obj({}) as PDFDict
  encDict.set(PDFName.of('Filter'), PDFName.of('Standard'))
  encDict.set(PDFName.of('V'), PDFNumber.of(5))
  encDict.set(PDFName.of('R'), PDFNumber.of(6))
  encDict.set(PDFName.of('Length'), PDFNumber.of(256))
  encDict.set(PDFName.of('CF'), cf)
  encDict.set(PDFName.of('StmF'), PDFName.of('StdCF'))
  encDict.set(PDFName.of('StrF'), PDFName.of('StdCF'))
  encDict.set(PDFName.of('O'), PDFHexString.of(bytesToHex(sec.O)))
  encDict.set(PDFName.of('U'), PDFHexString.of(bytesToHex(sec.U)))
  encDict.set(PDFName.of('OE'), PDFHexString.of(bytesToHex(sec.OE)))
  encDict.set(PDFName.of('UE'), PDFHexString.of(bytesToHex(sec.UE)))
  encDict.set(PDFName.of('Perms'), PDFHexString.of(bytesToHex(sec.Perms)))
  encDict.set(PDFName.of('P'), PDFNumber.of(sec.P))
  encDict.set(PDFName.of('EncryptMetadata'), encryptMeta ? PDFBool.True : PDFBool.False)
  const encRef = ctx.register(encDict)
  ctx.trailerInfo.Encrypt = encRef
  const id = PDFHexString.of(bytesToHex(random(16)))
  ctx.trailerInfo.ID = ctx.obj([id, id])
  onProgress?.(1)
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false })
}
