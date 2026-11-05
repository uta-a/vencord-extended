import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error ビルドスクリプト（.mjs）には型が無い
import { createZip } from '../../scripts/build/zip.mjs'
import {
  applyStagedRuntime,
  runtimeState,
  sha256Hex,
  stageRuntime,
  type RequiredRuntime
} from '../../src/plugins/voiceCord.discordDesktop/native/runtimeUpdate'
import { isSafeEntryName, readZip } from '../../src/plugins/voiceCord.discordDesktop/native/zip'

/**
 * ランタイムの取得と入れ替え。
 * 守っているのは「検証に通らないものを使わない」「中途半端な展開を使わない」「ランタイムが無い状態にしない」の 3 点
 */

const zipOf = (files: Record<string, string>): Buffer =>
  createZip(Object.entries(files).map(([name, data]) => ({ name, data: Buffer.from(data) })))

const runtimeZip = (version: string, extra: Record<string, string> = {}): Buffer =>
  zipOf({ 'manifest.json': JSON.stringify({ version }), 'engine.mjs': `// ${version}`, 'node_modules/frida/build/frida.node': 'bin', ...extra })

let tmp: string
let dir: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-runtime-'))
  dir = path.join(tmp, 'voicecord')
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const required = (zip: Buffer, version = 'v2'): RequiredRuntime => ({ version, sha256: sha256Hex(zip), url: 'https://example.invalid/r.zip' })
const writeRuntime = (d: string, version: string | null): void => {
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'engine.mjs'), `// ${version}`)
  if (version !== null) fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ version }))
}

describe('zip', () => {
  it('書いたものをそのまま読める（入れ子のパス・空のファイルを含む）', () => {
    const entries = readZip(zipOf({ 'a.txt': 'hello', 'x/y/z.bin': 'あいう', 'empty': '' }))
    expect(entries.map(e => [e.name, e.data.toString()])).toEqual([['a.txt', 'hello'], ['empty', ''], ['x/y/z.bin', 'あいう']])
  })

  it('展開先の外を指す名前を断つ', () => {
    for (const bad of ['../a', 'a/../../b', '/abs', 'C:/x', 'a\\b', 'a\0b', '', './a']) expect(isSafeEntryName(bad)).toBe(false)
    expect(isSafeEntryName('node_modules/frida/build/frida.node')).toBe(true)
    // 名前は crc の対象外なので、書いた後に差し替えて細工した zip を作る
    const zip = zipOf({ 'aa/x': 'evil' })
    const crafted = Buffer.from(zip.toString('latin1').split('aa/x').join('../x'), 'latin1')
    expect(() => readZip(crafted)).toThrow('展開先の外')
  })

  it('中身が壊れていたら読まない', () => {
    const zip = zipOf({ 'a.txt': 'hello hello hello hello' })
    const broken = Buffer.from(zip)
    broken[40] ^= 0xff
    expect(() => readZip(broken)).toThrow()
    expect(() => readZip(Buffer.from('not a zip at all, definitely not'))).toThrow('zip の形式ではありません')
  })
})

describe('runtimeState', () => {
  it('エンジンが無ければ missing、版が違うか記録が無ければ outdated、一致すれば ok', () => {
    const r = required(runtimeZip('v2'))
    expect(runtimeState(fs, dir, r)).toBe('missing')
    writeRuntime(dir, null)
    expect(runtimeState(fs, dir, r)).toBe('outdated')
    writeRuntime(dir, 'v1')
    expect(runtimeState(fs, dir, r)).toBe('outdated')
    writeRuntime(dir, 'v2')
    expect(runtimeState(fs, dir, r)).toBe('ok')
  })
})

describe('stageRuntime', () => {
  it('検証に通ったら .next に展開する（今のランタイムには触らない）', async () => {
    writeRuntime(dir, 'v1')
    const zip = runtimeZip('v2')
    await stageRuntime(fs, dir, required(zip), async () => zip)
    expect(fs.readFileSync(path.join(`${dir}.next`, 'engine.mjs'), 'utf8')).toBe('// v2')
    expect(fs.existsSync(path.join(`${dir}.next`, 'node_modules/frida/build/frida.node'))).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'engine.mjs'), 'utf8')).toBe('// v1')
    expect(fs.existsSync(`${dir}.tmp`)).toBe(false)
  })

  it('sha256 が一致しなければ、何も残さずに断る', async () => {
    const zip = runtimeZip('v2')
    const other = runtimeZip('v2', { 'extra.txt': 'x' })
    await expect(stageRuntime(fs, dir, required(zip), async () => other)).rejects.toThrow('sha256 が一致しません')
    expect(fs.existsSync(`${dir}.next`)).toBe(false)
    expect(fs.existsSync(`${dir}.tmp`)).toBe(false)
  })

  it('zip の版が必要な版と違えば断る', async () => {
    const zip = runtimeZip('v3')
    await expect(stageRuntime(fs, dir, required(zip, 'v2'), async () => zip)).rejects.toThrow('一致しません')
    expect(fs.existsSync(`${dir}.next`)).toBe(false)
  })
})

describe('applyStagedRuntime', () => {
  it('.next が必要な版なら入れ替え、古い版は消す', async () => {
    writeRuntime(dir, 'v1')
    const zip = runtimeZip('v2')
    const r = required(zip)
    await stageRuntime(fs, dir, r, async () => zip)
    expect(applyStagedRuntime(fs, dir, r)).toBe(true)
    expect(runtimeState(fs, dir, r)).toBe('ok')
    expect(fs.existsSync(`${dir}.next`)).toBe(false)
    expect(fs.existsSync(`${dir}.old`)).toBe(false)
  })

  it('ランタイムがまだ無くても入れ替えられる', async () => {
    const zip = runtimeZip('v2')
    const r = required(zip)
    await stageRuntime(fs, dir, r, async () => zip)
    expect(applyStagedRuntime(fs, dir, r)).toBe(true)
    expect(runtimeState(fs, dir, r)).toBe('ok')
  })

  it('.next が別の版（さらに新しい版が出た後の残り）なら捨てて、今のランタイムを残す', () => {
    writeRuntime(dir, 'v1')
    writeRuntime(`${dir}.next`, 'v2')
    const r = required(runtimeZip('v3'), 'v3')
    expect(applyStagedRuntime(fs, dir, r)).toBe(false)
    expect(fs.existsSync(`${dir}.next`)).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'engine.mjs'), 'utf8')).toBe('// v1')
  })

  it('.next が無ければ何もしない', () => {
    writeRuntime(dir, 'v1')
    expect(applyStagedRuntime(fs, dir, required(runtimeZip('v2')))).toBe(false)
  })
})

describe('失敗と競合', () => {
  /** 指定した rename だけ失敗させる fs（ほかは本物） */
  const failingFs = (fail: (from: string, to: string) => boolean) => ({
    ...fs,
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
    mkdirSync: fs.mkdirSync,
    rmSync: fs.rmSync,
    openSync: fs.openSync,
    closeSync: fs.closeSync,
    statSync: fs.statSync,
    unlinkSync: fs.unlinkSync,
    renameSync: (from: string, to: string) => {
      if (fail(from, to)) throw Object.assign(new Error('EPERM: 使用中'), { code: 'EPERM' })
      fs.renameSync(from, to)
    }
  })

  it('入れ替えも戻しも失敗して .old だけ残ったら、次の呼び出しで .old を消さずに戻す', async () => {
    writeRuntime(dir, 'v1')
    const zip = runtimeZip('v2')
    const r = required(zip)
    await stageRuntime(fs, dir, r, async () => zip)
    const broken = failingFs((from, to) => from === `${dir}.next` || (from === `${dir}.old` && to === dir))
    expect(() => applyStagedRuntime(broken, dir, r)).toThrow()
    expect(fs.existsSync(dir)).toBe(false)
    expect(fs.existsSync(`${dir}.old`)).toBe(true)
    // 次の起動までに .next が使えなくなっていても（別の版が出て捨てられた等）、旧版は失わない
    fs.rmSync(`${dir}.next`, { recursive: true })
    expect(applyStagedRuntime(fs, dir, r)).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'engine.mjs'), 'utf8')).toBe('// v1')
  })

  it('入れ替えが失敗しても、戻せたら今の版が残る', async () => {
    writeRuntime(dir, 'v1')
    const zip = runtimeZip('v2')
    const r = required(zip)
    await stageRuntime(fs, dir, r, async () => zip)
    const broken = failingFs(from => from === `${dir}.next`)
    expect(() => applyStagedRuntime(broken, dir, r)).toThrow()
    expect(fs.readFileSync(path.join(dir, 'engine.mjs'), 'utf8')).toBe('// v1')
  })

  it('別のプロセスが入れ替え中（ロックを持っている）なら、入れ替えずに今の版を使う', async () => {
    writeRuntime(dir, 'v1')
    const zip = runtimeZip('v2')
    const r = required(zip)
    await stageRuntime(fs, dir, r, async () => zip)
    fs.writeFileSync(`${dir}.lock`, '')
    expect(applyStagedRuntime(fs, dir, r)).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'engine.mjs'), 'utf8')).toBe('// v1')
    fs.rmSync(`${dir}.lock`)
    expect(applyStagedRuntime(fs, dir, r)).toBe(true)
  })

  it('同時に取得しても、展開途中のものを .next にしない（取得ごとに一時フォルダを分ける）', async () => {
    const zip = runtimeZip('v2')
    const r = required(zip)
    let release: () => void = () => {}
    const gate = new Promise<void>(res => { release = res })
    const a = stageRuntime(fs, dir, r, async () => { await gate; return zip })
    const b = stageRuntime(fs, dir, r, async () => zip)
    await b
    release()
    await a
    expect(runtimeState(fs, `${dir}.next`, r)).toBe('ok')
    expect(fs.readdirSync(tmp).filter(n => n.includes('.tmp'))).toEqual([])
  })

  it('取り消されたら .next を作らない', async () => {
    const zip = runtimeZip('v2')
    const ac = new AbortController()
    ac.abort()
    await expect(stageRuntime(fs, dir, required(zip), async () => zip, ac.signal)).rejects.toThrow()
    expect(fs.existsSync(`${dir}.next`)).toBe(false)
  })
})

describe('downloadLimited', () => {
  it('上限を超える応答は途中で断る', async () => {
    const { downloadLimited } = await import('../../src/plugins/voiceCord.discordDesktop/native/runtimeUpdate')
    const big = new Uint8Array(1024)
    const fetchStub = async () => new Response(new ReadableStream({
      start (c) { for (let i = 0; i < 10; i++) c.enqueue(big); c.close() }
    }))
    await expect(downloadLimited('https://example.invalid/x', { maxBytes: 4096, timeoutMs: 1000, fetch: fetchStub as typeof fetch })).rejects.toThrow('上限')
    const ok = await downloadLimited('https://example.invalid/x', { maxBytes: 20000, timeoutMs: 1000, fetch: fetchStub as typeof fetch })
    expect(ok.length).toBe(10240)
  })
})
