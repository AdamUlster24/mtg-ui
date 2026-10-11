import type { ServerEvent } from './types'

type Pending = { resolve: (data: any) => void; reject: (error: Error) => void }

/**
 * Websocket to the gateway: request/reply commands plus pushed game events.
 * Reconnects by itself; the gateway keeps the game session alive in between.
 */
export class Connection {
  private ws: WebSocket | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private closedByUs = false
  private retry = 0
  private keepalive: number | undefined

  onEvent: (event: ServerEvent) => void = () => {}
  onOpen: () => void = () => {}
  onClose: () => void = () => {}

  connect() {
    this.closedByUs = false
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${location.host}/ws`)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.keepalive = window.setInterval(() => ws.send('{"cmd":"keepalive"}'), 30_000)
      this.onOpen()
    }
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'reply') {
        const p = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (p) {
          if (msg.ok) p.resolve(msg.data)
          else p.reject(new Error(msg.error ?? 'Request failed'))
        }
      } else if (msg.type === 'event') {
        this.onEvent(msg)
      }
    }
    ws.onclose = () => {
      window.clearInterval(this.keepalive)
      this.pending.forEach((p) => p.reject(new Error('Connection lost')))
      this.pending.clear()
      this.onClose()
      if (!this.closedByUs) {
        this.retry = Math.min(this.retry + 1, 6)
        window.setTimeout(() => this.connect(), 400 * this.retry)
      }
    }
  }

  send<T = any>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'))
        return
      }
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, cmd, ...args }))
    })
  }
}
