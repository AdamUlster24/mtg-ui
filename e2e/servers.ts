import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PID_DIR = path.join(ROOT, 'e2e', 'test-results', '.servers')

export interface ServerSpec {
  name: string
  port: number
  xmagePort: number
  runDir: string
  testMode: boolean
  password: string
}

/** XMage test mode: cheat commands set up board states, no deck validation */
export const TEST_SERVER: ServerSpec = {
  name: 'test',
  port: 8090,
  xmagePort: 17271,
  runDir: path.join(ROOT, 'run-test'),
  testMode: true,
  password: '',
}

/** Same settings a real host uses: decks are validated, password required */
export const PLAY_SERVER: ServerSpec = {
  name: 'play',
  port: 8091,
  xmagePort: 17371,
  runDir: path.join(ROOT, 'run-play'),
  testMode: false,
  password: 'e2e-secret',
}

export const urlOf = (spec: ServerSpec) => `http://localhost:${spec.port}`

export async function isUp(spec: ServerSpec): Promise<boolean> {
  try {
    const res = await fetch(`${urlOf(spec)}/api/health`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

/** Starts a gateway (+ embedded XMage) unless one already answers on that port */
export async function startServer(spec: ServerSpec): Promise<void> {
  if (await isUp(spec)) return
  mkdirSync(PID_DIR, { recursive: true })
  mkdirSync(spec.runDir, { recursive: true })
  const log = openSync(path.join(spec.runDir, 'gateway.out'), 'w')
  const child = spawn(path.join(ROOT, 'scripts', 'run.sh'), [], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      SKIP_BUILD: process.env.E2E_SKIP_BUILD ?? '0',
      RUN_DIR: spec.runDir,
      GATEWAY_PORT: String(spec.port),
      XMAGE_PORT: String(spec.xmagePort),
      XMAGE_TEST_MODE: String(spec.testMode),
      GATEWAY_PASSWORD: spec.password,
      GATEWAY_HEAP: '2g',
      // a failed test leaves its game behind; free XMage's game threads quickly
      SESSION_TIMEOUT_MINUTES: '1',
    },
  })
  child.unref()
  writeFileSync(path.join(PID_DIR, `${spec.name}.pid`), String(child.pid))
  // first start builds the card database, which takes a while
  const deadline = Date.now() + 6 * 60_000
  while (Date.now() < deadline) {
    if (await isUp(spec)) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`Server "${spec.name}" did not start, see ${spec.runDir}/gateway.out`)
}

/** Stops only what startServer started (a server that was already running is left alone) */
export function stopServer(spec: ServerSpec): void {
  const file = path.join(PID_DIR, `${spec.name}.pid`)
  if (!existsSync(file)) return
  const pid = Number(readFileSync(file, 'utf8'))
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    // already gone
  }
  rmSync(file)
}
