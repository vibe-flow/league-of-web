import {
  ClientMessageType,
  type ClientMessage,
  type SnapshotPayload,
  type MatchPhase,
  type WsEnvelope,
} from '@template-dev/shared'

export class NetworkClient {
  private ws: WebSocket | null = null
  private sequenceNumber = 0
  private estimatedServerTick = 0

  private serverUrl = ''
  private matchId = ''
  private playerId = ''
  private token = ''

  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 10
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  onSnapshot: ((snapshot: SnapshotPayload) => void) | null = null
  onMatchPhase: ((phase: MatchPhase) => void) | null = null
  onConnectionChange: ((connected: boolean) => void) | null = null

  connect(serverUrl: string, matchId: string, playerId: string, token: string): void {
    this.serverUrl = serverUrl
    this.matchId = matchId
    this.playerId = playerId
    this.token = token
    this.reconnectAttempts = 0

    this.openConnection()
  }

  private openConnection(): void {
    const wsUrl = this.serverUrl.replace(/^http/, 'ws')
    const params = new URLSearchParams({
      matchId: this.matchId,
      playerId: this.playerId,
      token: this.token,
    })

    this.ws = new WebSocket(`${wsUrl}/game?${params}`)

    this.ws.onopen = () => {
      console.warn('[NetworkClient] Connected to game server')
      this.reconnectAttempts = 0
      this.onConnectionChange?.(true)
    }

    this.ws.onclose = () => {
      console.warn('[NetworkClient] Disconnected from game server')
      this.onConnectionChange?.(false)
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onclose fires after onerror
    }

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data)
    }
  }

  private handleMessage(raw: unknown): void {
    let envelope: WsEnvelope
    try {
      envelope = JSON.parse(raw as string)
    } catch {
      return
    }

    switch (envelope.event) {
      case 'snapshot':
        this.onSnapshot?.(envelope.data as SnapshotPayload)
        break
      case 'matchPhase':
        this.onMatchPhase?.((envelope.data as { phase: MatchPhase }).phase)
        break
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return

    const baseDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000)
    const jitter = Math.random() * 1000
    this.reconnectAttempts++

    this.reconnectTimer = setTimeout(() => {
      this.openConnection()
    }, baseDelay + jitter)
  }

  sendMove(x: number, y: number): void {
    this.sendInput(ClientMessageType.MOVE_TO, { x, y })
  }

  sendStop(): void {
    this.sendInput(ClientMessageType.STOP, {})
  }

  sendAttack(targetEntityId: string): void {
    this.sendInput(ClientMessageType.ATTACK_TARGET, { targetEntityId })
  }

  private sendInput(type: ClientMessageType, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const msg: ClientMessage = {
      type,
      seq: this.sequenceNumber++,
      tick: this.estimatedServerTick,
      payload,
    }

    const envelope: WsEnvelope = { event: 'input', data: msg }
    this.ws.send(JSON.stringify(envelope))
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempts = this.maxReconnectAttempts
    this.ws?.close()
    this.ws = null
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
