import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import type { IncomingMessage } from 'http'
import type { Server as HttpServer } from 'http'
import type { ClientMessage, WsEnvelope } from '@template-dev/shared'
import type { MatchManagerService } from './match/match-manager.service'

interface GameClient {
  ws: WebSocket
  matchId: string
  playerId: string
}

@Injectable()
export class GameWebSocketServer implements OnModuleDestroy {
  private readonly logger = new Logger(GameWebSocketServer.name)
  private wss: WebSocketServer | null = null

  /** ws instance → client metadata */
  private clients = new Map<WebSocket, GameClient>()
  /** matchId → set of ws instances */
  private matchRooms = new Map<string, Set<WebSocket>>()

  private matchManager!: MatchManagerService

  /**
   * Called by MatchManagerService to set the back-reference.
   * Avoids circular dependency issues with forwardRef.
   */
  setMatchManager(manager: MatchManagerService): void {
    this.matchManager = manager
  }

  /**
   * Attach the WebSocket server to the HTTP server.
   * Called from main.ts after the NestJS app starts listening.
   */
  attach(httpServer: HttpServer): void {
    this.wss = new WebSocketServer({ server: httpServer, path: '/game' })

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req)
    })

    this.logger.log('WebSocket server attached on path /game')
  }

  onModuleDestroy(): void {
    for (const [ws] of this.clients) {
      ws.close()
    }
    this.wss?.close()
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`)
    const matchId = url.searchParams.get('matchId')
    const playerId = url.searchParams.get('playerId')

    if (!matchId || !playerId) {
      this.logger.warn('Client connected without matchId/playerId — closing')
      ws.close(4000, 'Missing matchId or playerId')
      return
    }

    const match = this.matchManager.getMatch(matchId)
    if (!match) {
      this.logger.warn(`Client tried to join non-existent match ${matchId}`)
      ws.close(4001, 'Match not found')
      return
    }

    // Register client
    const client: GameClient = { ws, matchId, playerId }
    this.clients.set(ws, client)

    // Add to match room
    let room = this.matchRooms.get(matchId)
    if (!room) {
      room = new Set()
      this.matchRooms.set(matchId, room)
    }
    room.add(ws)

    match.addClient(playerId)

    this.logger.log(`Player ${playerId} connected to match ${matchId}`)

    ws.on('message', (raw) => {
      this.handleMessage(client, raw)
    })

    ws.on('close', () => {
      this.handleDisconnect(client)
    })

    ws.on('error', (err) => {
      this.logger.error(`WebSocket error for player ${playerId}: ${err.message}`)
    })
  }

  private handleMessage(client: GameClient, raw: RawData): void {
    let envelope: WsEnvelope
    try {
      envelope = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (envelope.event === 'input') {
      const match = this.matchManager.getMatch(client.matchId)
      match?.handleInput(client.playerId, envelope.data as ClientMessage)
    }
  }

  private handleDisconnect(client: GameClient): void {
    const match = this.matchManager.getMatch(client.matchId)
    match?.removeClient(client.playerId)

    // Remove from room
    const room = this.matchRooms.get(client.matchId)
    if (room) {
      room.delete(client.ws)
      if (room.size === 0) {
        this.matchRooms.delete(client.matchId)
      }
    }

    this.clients.delete(client.ws)
    this.logger.log(`Player ${client.playerId} disconnected from match ${client.matchId}`)
  }

  /** Broadcast an event to all clients in a match */
  broadcastToMatch(matchId: string, event: string, data: unknown): void {
    const room = this.matchRooms.get(matchId)
    if (!room) return

    const message = JSON.stringify({ event, data } satisfies WsEnvelope)
    for (const ws of room) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message)
      }
    }
  }

  /** Close all sockets in a match room and clean up. Called when a match is destroyed. */
  cleanupMatchRoom(matchId: string): void {
    const room = this.matchRooms.get(matchId)
    if (!room) return

    for (const ws of room) {
      this.clients.delete(ws)
      ws.close(4002, 'Match ended')
    }
    this.matchRooms.delete(matchId)
  }
}
