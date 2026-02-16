# Netcode Technical Specification

> Web-based MOBA (ARAM mode) -- NestJS WebSocket server, PixiJS client, TypeScript throughout.

---

## Table of Contents

1. [Server-Authoritative Model](#1-server-authoritative-model)
2. [Game Loop Server](#2-game-loop-server)
3. [Client-Server Communication Protocol](#3-client-server-communication-protocol)
4. [Client-Side Prediction](#4-client-side-prediction)
5. [Server Reconciliation](#5-server-reconciliation)
6. [Entity Interpolation](#6-entity-interpolation)
7. [Lag Compensation](#7-lag-compensation)
8. [Bandwidth Optimization](#8-bandwidth-optimization)
9. [Connection Handling](#9-connection-handling)
10. [Anti-Cheat Considerations](#10-anti-cheat-considerations)

---

## Architecture Overview

```
 CLIENT (Browser, 60fps)                         SERVER (NestJS, 30Hz)
 ========================                         ====================

 PixiJS Renderer (60fps)                          Game Loop (30Hz / 33ms tick)
        |                                                |
 Input Handler ----[ WebSocket ]----> Input Queue        |
        |              |              (buffered)         |
 Local Prediction      |                   |             |
        |              |          Collect & Validate Inputs
 Interpolation         |                   |             |
   (other entities)    |          Process Game Logic     |
        |              |                   |             |
 Reconciliation  <-----+---- Snapshot Broadcast          |
        |                          |                     |
 Render Frame                 Delta Compression          |
                              FoW Filtering              |
                              Interest Mgmt              |
```

---

## 1. Server-Authoritative Model

The server is the **single source of truth** for all game state. Clients are untrusted
input devices. They send _intentions_ (where they want to move, which ability they want
to cast); the server validates and executes every action.

### Core Principles

| Principle                         | Description                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Server owns state**             | Position, health, cooldowns, buffs, gold -- all canonical values live on the server.                       |
| **Clients send intentions**       | A right-click sends `{ type: "MOVE", target: {x, y} }`, not `{ type: "SET_POSITION", pos: {x, y} }`.       |
| **Server validates everything**   | Movement speed, ability range, cooldown timers, line-of-sight -- all checked server-side before execution. |
| **Clients render approximations** | What the player sees is a prediction/interpolation of the true server state.                               |

### Input vs. State Flow

```
  Client A                   Server                    Client B
  ========                   ======                    ========

  Right-click (500,300)
       |
       |--- InputMsg ------->|
       |                     | Validate: is champion alive?
       |                     |           is position reachable?
       |                     |           is movement speed legal?
       |                     |
       |                     | Execute: set pathfinding target
       |                     | Update: move champion along path
       |                     |
       |<--- Snapshot -------|------- Snapshot -------->|
       |                     |
  Reconcile local            |                   Interpolate A's
  prediction                 |                   new position
```

### Server-Side Authority Types

```typescript
// server/src/game/authority.ts

/**
 * Every game action falls into one of these authority categories.
 * The server NEVER trusts client-reported values for authoritative fields.
 */
interface AuthoritativeState {
  // === Fully Authoritative (server computes, client never sets) ===
  champion: {
    position: Vec2 // server pathfinds and moves
    health: number // server applies damage/healing
    mana: number // server tracks costs
    level: number // server awards XP
    gold: number // server awards gold
    alive: boolean // server controls death/respawn
    buffs: Buff[] // server applies/removes
    cooldowns: number[] // server tracks per ability
  }

  // === Validated Inputs (client suggests, server validates) ===
  inputs: {
    moveTarget: Vec2 // validated: reachable? in bounds?
    abilitySlot: number // validated: off cooldown? enough mana? in range?
    abilityTarget: Vec2 // validated: valid target location?
    attackTarget: string // validated: entity exists? in range?
  }

  // === Cosmetic Only (client can do freely, server ignores) ===
  cosmetic: {
    emote: string // no gameplay impact
    pingLocation: Vec2 // just communication
    cameraPosition: Vec2 // local only
  }
}
```

---

## 2. Game Loop Server

The server runs a **fixed-timestep** game loop at **30Hz** (one tick every ~33.33ms). This
is the heartbeat of the entire game. Every tick follows the same deterministic sequence.

### Tick Pipeline

```
 Tick N (33.33ms budget)
 =======================

 [1] Collect Inputs         0-2ms    Drain input queue, assign to tick N
         |
 [2] Process Inputs         2-8ms    Validate + execute movement, abilities, attacks
         |
 [3] Update Physics         1-4ms    Move projectiles, apply forces, update paths
         |
 [4] Check Collisions       2-6ms    Skillshot hits, area effects, wall collisions
         |
 [5] Apply Game Rules       1-3ms    Death checks, buff expiry, cooldown ticks
         |
 [6] Capture Snapshot       1-2ms    Serialize world state for this tick
         |
 [7] Broadcast              1-3ms    Delta-compress, FoW-filter, send per-client
         |
 [8] Housekeeping           <1ms     Clean expired data, update metrics
```

### Implementation

```typescript
// server/src/game/game-loop.ts

import { Logger } from '@nestjs/common'

export class GameLoop {
  private readonly logger = new Logger(GameLoop.name)

  static readonly TICK_RATE = 30
  static readonly TICK_INTERVAL_MS = 1000 / GameLoop.TICK_RATE // 33.33ms

  private tickNumber = 0
  private running = false
  private timer: ReturnType<typeof setInterval> | null = null
  private lastTickTime: number = 0

  constructor(
    private readonly inputQueue: InputQueue,
    private readonly simulation: GameSimulation,
    private readonly snapshotManager: SnapshotManager,
    private readonly broadcaster: Broadcaster,
  ) {}

  start(): void {
    this.running = true
    this.lastTickTime = performance.now()

    // setInterval for simplicity; see note below on timing strategies
    this.timer = setInterval(() => {
      this.tick()
    }, GameLoop.TICK_INTERVAL_MS)

    this.logger.log(`Game loop started at ${GameLoop.TICK_RATE}Hz`)
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.logger.log(`Game loop stopped at tick ${this.tickNumber}`)
  }

  private tick(): void {
    const tickStart = performance.now()
    const dt = GameLoop.TICK_INTERVAL_MS / 1000 // fixed dt in seconds (0.0333)

    // ---[1] Collect Inputs---
    const inputs = this.inputQueue.drainForTick(this.tickNumber)

    // ---[2] Process Inputs---
    for (const input of inputs) {
      this.simulation.processInput(input)
    }

    // ---[3] Update Physics---
    this.simulation.updatePhysics(dt)

    // ---[4] Check Collisions---
    this.simulation.checkCollisions()

    // ---[5] Apply Game Rules---
    this.simulation.applyGameRules(dt)

    // ---[6] Capture Snapshot---
    const snapshot = this.snapshotManager.capture(this.tickNumber, this.simulation.getWorldState())

    // ---[7] Broadcast---
    this.broadcaster.broadcastSnapshot(snapshot)

    // ---[8] Housekeeping---
    this.snapshotManager.pruneOldSnapshots(this.tickNumber - 300) // keep ~10s
    this.tickNumber++

    // Performance monitoring
    const tickDuration = performance.now() - tickStart
    if (tickDuration > GameLoop.TICK_INTERVAL_MS) {
      this.logger.warn(
        `Tick ${this.tickNumber} overran: ${tickDuration.toFixed(1)}ms ` +
          `(budget: ${GameLoop.TICK_INTERVAL_MS.toFixed(1)}ms)`,
      )
    }
  }
}
```

### Input Queue

Inputs arrive asynchronously from WebSocket connections but must be processed in a
deterministic order during the tick.

```typescript
// server/src/game/input-queue.ts

interface QueuedInput {
  playerId: string
  input: PlayerInput
  receivedAt: number // server timestamp when received
  clientTick: number // tick the client thinks it was on
  sequenceNumber: number // monotonic per-player sequence
}

export class InputQueue {
  private queue: QueuedInput[] = []

  enqueue(item: QueuedInput): void {
    this.queue.push(item)
  }

  /**
   * Drain all inputs queued for this tick.
   * Sorts by receivedAt to maintain deterministic ordering.
   */
  drainForTick(currentTick: number): QueuedInput[] {
    const inputs = this.queue
      .splice(0, this.queue.length)
      .sort((a, b) => a.receivedAt - b.receivedAt)

    return inputs
  }
}
```

### Timing Considerations

`setInterval` is not perfectly precise in Node.js. For production, consider a
high-resolution loop:

```typescript
// Alternative: busy-wait hybrid for tighter timing
function preciseLoop(callback: () => void, intervalMs: number): void {
  let expected = performance.now() + intervalMs

  const step = () => {
    const now = performance.now()
    const drift = now - expected

    if (drift >= 0) {
      callback()
      expected += intervalMs

      // If we drifted more than a full tick, skip ahead
      if (drift > intervalMs) {
        expected = now + intervalMs
      }
    }

    // Use setTimeout(0) when far from deadline, busy-wait when close
    if (expected - performance.now() > 4) {
      setTimeout(step, 1)
    } else {
      setImmediate(step)
    }
  }

  setTimeout(step, 1)
}
```

---

## 3. Client-Server Communication Protocol

All communication uses **WebSocket** (persistent bidirectional TCP). Messages flow in
two directions with different shapes.

### Message Direction and Types

```
 Client --> Server (Inputs)          Server --> Client (State)
 ==========================          =========================

 MOVE_TO_POSITION                    GAME_STATE_SNAPSHOT
 CAST_ABILITY                        ENTITY_DELTA_UPDATE
 ATTACK_TARGET                       ABILITY_EVENT
 STOP_MOVEMENT                       DAMAGE_EVENT
 USE_ITEM                            DEATH_EVENT
 PING_MAP                            CHAT_MESSAGE
 CHAT_MESSAGE                        PING_RESPONSE
 PING_REQUEST                        PLAYER_DISCONNECTED
                                     PLAYER_RECONNECTED
                                     GAME_OVER
```

### Message Envelope

Every message uses a common envelope:

```typescript
// shared/src/protocol/messages.ts

/** Sent by client */
interface ClientMessage {
  type: ClientMessageType
  seq: number // per-player monotonic sequence number
  tick: number // client's current local tick estimate
  payload: unknown // type-specific data
}

/** Sent by server */
interface ServerMessage {
  type: ServerMessageType
  tick: number // authoritative server tick
  timestamp: number // server time (ms since game start)
  payload: unknown // type-specific data
}
```

### Client Message Types

```typescript
// shared/src/protocol/client-messages.ts

enum ClientMessageType {
  MOVE_TO = 0x01,
  CAST_ABILITY = 0x02,
  ATTACK_TARGET = 0x03,
  STOP = 0x04,
  USE_ITEM = 0x05,
  PING_MAP = 0x06,
  CHAT = 0x07,
  PING_REQUEST = 0x08,
}

interface MoveToPayload {
  x: number // world-space target X
  y: number // world-space target Y
}

interface CastAbilityPayload {
  slot: number // 0=Q, 1=W, 2=E, 3=R, 4=D, 5=F
  targetX: number // aim position X (for skillshots)
  targetY: number // aim position Y
  targetId?: string // target entity ID (for targeted abilities)
}

interface AttackTargetPayload {
  targetId: string // entity ID to auto-attack
}
```

### Server Message Types

```typescript
// shared/src/protocol/server-messages.ts

enum ServerMessageType {
  SNAPSHOT = 0x10,
  DELTA = 0x11,
  ABILITY_EVENT = 0x12,
  DAMAGE_EVENT = 0x13,
  DEATH_EVENT = 0x14,
  CHAT = 0x15,
  PING_RESPONSE = 0x16,
  PLAYER_STATUS = 0x17,
  GAME_OVER = 0x18,
}

/** Full world snapshot (sent on connect and periodically as keyframes) */
interface SnapshotPayload {
  champions: ChampionState[]
  minions: MinionState[]
  projectiles: ProjectileState[]
  turrets: TurretState[]
}

/** Delta update (sent every tick, only changed fields) */
interface DeltaPayload {
  updated: EntityDelta[] // partial updates for changed entities
  created: EntityState[] // newly spawned entities
  removed: string[] // IDs of destroyed entities
}

interface ChampionState {
  id: string
  championType: string // e.g. "ashe", "jinx"
  team: number // 0 = blue, 1 = red
  x: number
  y: number
  health: number
  maxHealth: number
  mana: number
  maxMana: number
  level: number
  alive: boolean
  facing: number // angle in radians
  movementSpeed: number
  buffs: BuffState[]
  cooldowns: [number, number, number, number, number, number] // remaining ms per slot
}
```

### Binary vs. JSON

| Format            | Pros                                   | Cons                                    | Use Case                         |
| ----------------- | -------------------------------------- | --------------------------------------- | -------------------------------- |
| **JSON**          | Human-readable, easy debug, native JS  | Verbose, larger payload, slower parse   | Chat, pings, non-critical        |
| **MessagePack**   | ~30-50% smaller than JSON, schema-less | Still somewhat verbose                  | General game state               |
| **Custom binary** | Minimal overhead, exact control        | Complex to maintain, versioning is hard | High-frequency state (positions) |

The recommended approach is **MessagePack for game state** and **JSON for non-critical
messages** (chat, pings). See [Section 8](#8-bandwidth-optimization) for binary
serialization details.

```typescript
// shared/src/protocol/codec.ts

import { encode, decode } from '@msgpack/msgpack'

export class MessageCodec {
  /**
   * Encode a server message for transmission.
   * Game-critical messages use MessagePack; chat/pings use JSON.
   */
  static encode(msg: ServerMessage): ArrayBuffer {
    if (msg.type >= 0x10 && msg.type <= 0x14) {
      // Game state messages: use MessagePack
      return encode(msg) as ArrayBuffer
    }
    // Non-critical: use JSON (easier to debug)
    return new TextEncoder().encode(JSON.stringify(msg)).buffer
  }

  /**
   * Decode an incoming message.
   * First byte determines encoding: 0x00 = JSON, 0x01 = MessagePack.
   */
  static decode(data: ArrayBuffer): ClientMessage {
    const view = new Uint8Array(data)
    const format = view[0]
    const payload = view.slice(1)

    if (format === 0x01) {
      return decode(payload) as ClientMessage
    }
    return JSON.parse(new TextDecoder().decode(payload)) as ClientMessage
  }
}
```

### NestJS WebSocket Gateway

```typescript
// server/src/gateway/game.gateway.ts

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'

@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket'], // force WebSocket, skip HTTP long-polling
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server

  constructor(
    private readonly gameService: GameService,
    private readonly inputQueue: InputQueue,
  ) {}

  handleConnection(client: Socket): void {
    const playerId = this.gameService.authenticateSocket(client)
    if (!playerId) {
      client.disconnect()
      return
    }
    client.data.playerId = playerId
    this.gameService.onPlayerConnected(playerId, client)
  }

  handleDisconnect(client: Socket): void {
    this.gameService.onPlayerDisconnected(client.data.playerId)
  }

  @SubscribeMessage('input')
  handleInput(@ConnectedSocket() client: Socket, @MessageBody() data: ClientMessage): void {
    this.inputQueue.enqueue({
      playerId: client.data.playerId,
      input: data.payload as PlayerInput,
      receivedAt: performance.now(),
      clientTick: data.tick,
      sequenceNumber: data.seq,
    })
  }

  /**
   * Called by the Broadcaster at the end of each tick.
   */
  sendToPlayer(playerId: string, message: ServerMessage): void {
    const socket = this.gameService.getSocket(playerId)
    if (socket?.connected) {
      socket.volatile.emit('state', MessageCodec.encode(message))
      //      ^^^^^^^^ drop if socket buffer is full; stale state is useless
    }
  }
}
```

---

## 4. Client-Side Prediction

The client applies movement **immediately** on input without waiting for server
confirmation. This hides the round-trip latency and makes the game feel responsive.

### Why Predict?

Without prediction, a player with 80ms ping would see their champion start moving
80ms after clicking. At 60fps that is ~5 frames of visible delay -- unacceptable for a
MOBA.

```
 Without prediction:                 With prediction:

 Click ------80ms------> Server      Click --> Predict instantly
                          |                       |
              Server processes                Render movement
                          |                       |
       <-----80ms------ Confirm      <---80ms--- Confirm
                          |                       |
       START moving (160ms!)         Reconcile (no visible delay)
```

### Prediction Implementation

```typescript
// client/src/net/prediction.ts

interface PredictedInput {
  seq: number
  tick: number
  input: PlayerInput
  predictedPosition: Vec2 // where we thought we'd be
  timestamp: number
}

export class ClientPrediction {
  /** Unacknowledged inputs awaiting server confirmation. */
  private pendingInputs: PredictedInput[] = []
  private sequenceNumber = 0

  constructor(
    private readonly localChampion: LocalChampion,
    private readonly connection: ServerConnection,
  ) {}

  /**
   * Called when the player right-clicks to move.
   * Applies movement locally AND sends the input to the server.
   */
  onMoveCommand(targetX: number, targetY: number): void {
    const input: PlayerInput = {
      type: ClientMessageType.MOVE_TO,
      x: targetX,
      y: targetY,
    }

    const seq = this.sequenceNumber++

    // --- Predict locally ---
    // Compute path the same way the server would
    const path = this.localChampion.computePath(targetX, targetY)
    this.localChampion.setPath(path)

    // Store the prediction so we can reconcile later
    this.pendingInputs.push({
      seq,
      tick: this.connection.estimatedServerTick,
      input,
      predictedPosition: { ...this.localChampion.position },
      timestamp: performance.now(),
    })

    // --- Send to server ---
    this.connection.send({
      type: ClientMessageType.MOVE_TO,
      seq,
      tick: this.connection.estimatedServerTick,
      payload: { x: targetX, y: targetY },
    })
  }

  /**
   * Called when the player casts an ability.
   * Some abilities can be predicted (self-buff, dash); others cannot (damage).
   */
  onAbilityCommand(slot: number, targetX: number, targetY: number): void {
    const input: PlayerInput = {
      type: ClientMessageType.CAST_ABILITY,
      slot,
      targetX,
      targetY,
    }

    const seq = this.sequenceNumber++

    // Only predict abilities with local-only visual effects (e.g., dash)
    if (this.localChampion.isAbilityPredictable(slot)) {
      this.localChampion.predictAbility(slot, targetX, targetY)
    }

    this.pendingInputs.push({
      seq,
      tick: this.connection.estimatedServerTick,
      input,
      predictedPosition: { ...this.localChampion.position },
      timestamp: performance.now(),
    })

    this.connection.send({
      type: ClientMessageType.CAST_ABILITY,
      seq,
      tick: this.connection.estimatedServerTick,
      payload: { slot, targetX, targetY },
    })
  }

  /**
   * Called every frame to advance the predicted champion along the path.
   */
  updatePrediction(dt: number): void {
    this.localChampion.advanceAlongPath(dt)
  }

  /**
   * Called when a server snapshot arrives. See Section 5 (Reconciliation).
   */
  onServerSnapshot(snapshot: ServerSnapshot): void {
    // Discard inputs that the server has acknowledged
    const lastProcessedSeq = snapshot.lastProcessedSeq
    this.pendingInputs = this.pendingInputs.filter((p) => p.seq > lastProcessedSeq)

    // Reconcile -- see Section 5
  }
}
```

### Local Champion Predicted Movement

```typescript
// client/src/entities/local-champion.ts

export class LocalChampion {
  position: Vec2 = { x: 0, y: 0 }
  private path: Vec2[] = []
  private pathIndex = 0
  private speed = 325 // base movement speed (units/sec)

  computePath(targetX: number, targetY: number): Vec2[] {
    // Simplified A* or navmesh query (same algorithm as server)
    // Returns array of waypoints from current position to target
    return Pathfinding.findPath(this.position, { x: targetX, y: targetY })
  }

  setPath(path: Vec2[]): void {
    this.path = path
    this.pathIndex = 0
  }

  /**
   * Move along the current path. Called every frame (60fps).
   */
  advanceAlongPath(dt: number): void {
    if (this.pathIndex >= this.path.length) return

    const target = this.path[this.pathIndex]
    const dx = target.x - this.position.x
    const dy = target.y - this.position.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    const step = this.speed * dt

    if (dist <= step) {
      // Reached waypoint
      this.position.x = target.x
      this.position.y = target.y
      this.pathIndex++
    } else {
      // Move toward waypoint
      this.position.x += (dx / dist) * step
      this.position.y += (dy / dist) * step
    }
  }
}
```

---

## 5. Server Reconciliation

When the server snapshot arrives and the local champion's position disagrees with the
server's authoritative position, the client must correct itself. Naive teleportation
causes jarring pops. Instead we use **threshold-based correction with lerp**.

### Reconciliation Strategy

```
 Server says: (200, 150)
 Client predicted: (207, 148)
 Error: ~7.3 units

 If error < SNAP_THRESHOLD (2 units):
     Ignore. Prediction is close enough.

 If error >= SNAP_THRESHOLD and < TELEPORT_THRESHOLD (100 units):
     Smoothly lerp toward server position over several frames.

 If error >= TELEPORT_THRESHOLD:
     Snap instantly. Something went very wrong (lag spike, desync).
```

### Implementation

```typescript
// client/src/net/reconciliation.ts

export class ServerReconciliation {
  /** Below this, don't bother correcting. */
  private static readonly SNAP_THRESHOLD = 2

  /** Above this, teleport instantly. */
  private static readonly TELEPORT_THRESHOLD = 100

  /** How fast to blend toward the server position (0-1 per frame). */
  private static readonly LERP_SPEED = 0.15

  private correctionTarget: Vec2 | null = null
  private isLerping = false

  constructor(
    private readonly localChampion: LocalChampion,
    private readonly prediction: ClientPrediction,
  ) {}

  /**
   * Called when a server state snapshot is received.
   */
  onServerState(serverState: ChampionState, lastProcessedSeq: number): void {
    const serverPos: Vec2 = { x: serverState.x, y: serverState.y }
    const clientPos = this.localChampion.position

    // --- Step 1: Discard acknowledged inputs ---
    this.prediction.onServerSnapshot({
      lastProcessedSeq,
      position: serverPos,
    })

    // --- Step 2: Re-simulate unacknowledged inputs ---
    // Start from the server's authoritative position and replay
    // all inputs that the server hasn't processed yet.
    const replayPos = this.replayPendingInputs(
      serverPos,
      serverState,
      this.prediction.getPendingInputs(),
    )

    // --- Step 3: Compare replayed position with current prediction ---
    const error = Vec2.distance(replayPos, clientPos)

    if (error < ServerReconciliation.SNAP_THRESHOLD) {
      // Close enough. Accept current predicted position.
      return
    }

    if (error >= ServerReconciliation.TELEPORT_THRESHOLD) {
      // Massive desync. Snap immediately.
      this.localChampion.position.x = replayPos.x
      this.localChampion.position.y = replayPos.y
      this.isLerping = false
      return
    }

    // Moderate error. Lerp toward the correct position.
    this.correctionTarget = replayPos
    this.isLerping = true
  }

  /**
   * Re-simulate all unacknowledged inputs from the server's authoritative state.
   * This gives us where the client SHOULD be if the prediction was perfect.
   */
  private replayPendingInputs(
    startPos: Vec2,
    serverState: ChampionState,
    pendingInputs: PredictedInput[],
  ): Vec2 {
    // Create a temporary simulation state starting from server position
    const simPos = { ...startPos }
    const simSpeed = serverState.movementSpeed
    const dt = 1 / GameLoop.TICK_RATE // simulate at tick rate

    for (const pending of pendingInputs) {
      if (pending.input.type === ClientMessageType.MOVE_TO) {
        // Simulate one tick of movement toward the target
        const target = { x: pending.input.x, y: pending.input.y }
        const dx = target.x - simPos.x
        const dy = target.y - simPos.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const step = simSpeed * dt

        if (dist > step) {
          simPos.x += (dx / dist) * step
          simPos.y += (dy / dist) * step
        } else {
          simPos.x = target.x
          simPos.y = target.y
        }
      }
    }

    return simPos
  }

  /**
   * Called every frame (60fps) to apply smooth correction.
   */
  updateCorrection(): void {
    if (!this.isLerping || !this.correctionTarget) return

    const pos = this.localChampion.position
    pos.x = lerp(pos.x, this.correctionTarget.x, ServerReconciliation.LERP_SPEED)
    pos.y = lerp(pos.y, this.correctionTarget.y, ServerReconciliation.LERP_SPEED)

    // Stop lerping once close enough
    const remaining = Vec2.distance(pos, this.correctionTarget)
    if (remaining < 0.5) {
      pos.x = this.correctionTarget.x
      pos.y = this.correctionTarget.y
      this.isLerping = false
      this.correctionTarget = null
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
```

### Reconciliation for Non-Position State

Health, mana, buffs, and cooldowns are **not predicted** (except cosmetically). When a
server snapshot arrives, these values are applied directly:

```typescript
// client/src/net/state-sync.ts

export class StateSync {
  applyServerState(champion: LocalChampion, state: ChampionState): void {
    // Health bar: lerp for visual smoothness
    champion.displayHealth = lerp(champion.displayHealth, state.health, 0.3)
    champion.actualHealth = state.health

    // Mana: direct set (small bar, lerp unnecessary)
    champion.mana = state.mana
    champion.maxMana = state.maxMana

    // Cooldowns: direct set
    champion.cooldowns = [...state.cooldowns]

    // Buffs: replace entirely
    champion.buffs = state.buffs.map((b) => ({
      type: b.type,
      remaining: b.remaining,
      stacks: b.stacks,
    }))

    // Level: direct set (triggers level-up VFX if changed)
    if (champion.level !== state.level) {
      champion.level = state.level
      champion.playLevelUpEffect()
    }
  }
}
```

---

## 6. Entity Interpolation

Other players (and all remote entities) are rendered **in the past**, interpolating
between two known server snapshots. This ensures smooth movement even with packet
jitter.

### Interpolation Timing

```
 Server ticks:   T0 -------- T1 -------- T2 -------- T3 -------- T4
                 33ms         33ms         33ms         33ms

 What client renders for remote entities:

                                     [rendered here]
                                          |
                  T1 -------- T2 -------- T3 -------- T4
                   ^            ^
                   |            |
              snapshot A   snapshot B

 Render time = current_server_time - interpolation_delay
 interpolation_delay = 100ms (3 ticks behind)

 When rendering at time t between T1 and T2:
   fraction = (t - T1.timestamp) / (T2.timestamp - T1.timestamp)
   position = lerp(T1.position, T2.position, fraction)
```

### Snapshot Buffer

```typescript
// client/src/net/interpolation.ts

interface Snapshot {
  tick: number
  timestamp: number // server timestamp (ms since game start)
  entities: Map<string, EntityState>
}

export class InterpolationBuffer {
  /**
   * How far in the past to render remote entities (ms).
   * 100ms = ~3 server ticks at 30Hz. Provides a buffer for jitter.
   */
  static readonly INTERPOLATION_DELAY_MS = 100

  private snapshots: Snapshot[] = []
  private readonly maxSnapshots = 30 // ~1 second of history

  /**
   * Add a new snapshot from the server.
   */
  push(snapshot: Snapshot): void {
    // Insert sorted by tick (should already be in order, but guard against reorder)
    const insertIdx = this.snapshots.findIndex((s) => s.tick > snapshot.tick)
    if (insertIdx === -1) {
      this.snapshots.push(snapshot)
    } else {
      this.snapshots.splice(insertIdx, 0, snapshot)
    }

    // Prune old snapshots
    while (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift()
    }
  }

  /**
   * Get the interpolated state of a remote entity at the current render time.
   */
  getInterpolatedState(entityId: string, currentServerTime: number): EntityState | null {
    const renderTime = currentServerTime - InterpolationBuffer.INTERPOLATION_DELAY_MS

    // Find the two snapshots that straddle renderTime
    let before: Snapshot | null = null
    let after: Snapshot | null = null

    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (
        this.snapshots[i].timestamp <= renderTime &&
        this.snapshots[i + 1].timestamp >= renderTime
      ) {
        before = this.snapshots[i]
        after = this.snapshots[i + 1]
        break
      }
    }

    if (!before || !after) {
      // No bracketing snapshots. Use the latest available (extrapolation fallback).
      const latest = this.snapshots[this.snapshots.length - 1]
      return latest?.entities.get(entityId) ?? null
    }

    const entityBefore = before.entities.get(entityId)
    const entityAfter = after.entities.get(entityId)

    if (!entityBefore || !entityAfter) {
      // Entity didn't exist in one of the snapshots
      return entityAfter ?? entityBefore ?? null
    }

    // Compute interpolation fraction
    const totalDuration = after.timestamp - before.timestamp
    const elapsed = renderTime - before.timestamp
    const t = Math.max(0, Math.min(1, elapsed / totalDuration))

    return this.lerpEntityState(entityBefore, entityAfter, t)
  }

  private lerpEntityState(a: EntityState, b: EntityState, t: number): EntityState {
    return {
      id: b.id,
      entityType: b.entityType,
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      facing: lerpAngle(a.facing, b.facing, t),
      health: lerp(a.health, b.health, t),
      maxHealth: b.maxHealth,
      // Non-interpolated fields: use latest value
      alive: b.alive,
      team: b.team,
      buffs: b.buffs,
      animationState: b.animationState,
    }
  }
}
```

### Rendering Interpolated Entities

```typescript
// client/src/renderer/entity-renderer.ts

export class EntityRenderer {
  constructor(
    private readonly stage: PIXI.Container,
    private readonly interpolationBuffer: InterpolationBuffer,
    private readonly localPlayerId: string,
  ) {}

  /**
   * Called every frame (60fps). Renders all visible entities.
   */
  render(currentServerTime: number, entities: Map<string, EntitySprite>): void {
    for (const [entityId, sprite] of entities) {
      if (entityId === this.localPlayerId) {
        // Local player uses prediction, not interpolation
        continue
      }

      const state = this.interpolationBuffer.getInterpolatedState(entityId, currentServerTime)

      if (!state) {
        sprite.visible = false
        continue
      }

      sprite.visible = state.alive
      sprite.position.set(state.x, state.y)
      sprite.rotation = state.facing
      sprite.updateHealthBar(state.health, state.maxHealth)
      sprite.updateAnimation(state.animationState)
    }
  }
}
```

### Interpolation vs. Extrapolation

| Technique         | When Used                              | Tradeoff                                  |
| ----------------- | -------------------------------------- | ----------------------------------------- |
| **Interpolation** | Normal operation (snapshots available) | Smooth but ~100ms behind reality          |
| **Extrapolation** | Packet loss (no recent snapshot)       | Current but can be wrong (rubber-banding) |

Extrapolation should be limited to 2-3 ticks (~66-100ms). Beyond that, freeze the
entity in place rather than compound the error.

```typescript
/**
 * Limited extrapolation when packets are delayed.
 */
function extrapolatePosition(lastState: EntityState, velocity: Vec2, elapsedMs: number): Vec2 {
  const MAX_EXTRAPOLATE_MS = 100
  const t = Math.min(elapsedMs, MAX_EXTRAPOLATE_MS) / 1000
  return {
    x: lastState.x + velocity.x * t,
    y: lastState.y + velocity.y * t,
  }
}
```

---

## 7. Lag Compensation

For skillshots and other time-sensitive hits, the server must evaluate collisions **from
the shooter's perspective at the time they fired**. Because the shooter sees other
players ~RTT/2 + interpolation_delay in the past, the server rewinds its state history
to match.

### Why Lag Compensation?

```
 Player A (80ms ping) fires skillshot at Player B.
 Player A sees B at position (400, 200) -- but that is where B was ~140ms ago:
   80ms (half RTT) + 100ms (interpolation delay) = ~140ms

 On the server RIGHT NOW, B is at (450, 210).
 Without lag compensation: the skillshot misses (B moved away).
 With lag compensation: server checks where B was 140ms ago -- the shot hits.
```

### State History Buffer (Server)

```typescript
// server/src/game/state-history.ts

interface HistoricalState {
  tick: number
  timestamp: number
  entities: Map<string, EntitySnapshot>
}

interface EntitySnapshot {
  id: string
  x: number
  y: number
  hitboxRadius: number
  alive: boolean
}

export class StateHistory {
  private history: HistoricalState[] = []

  /** Keep enough history for max expected lag + interpolation delay. */
  private readonly maxHistoryMs = 500

  /**
   * Called at the end of each tick to record the current state.
   */
  record(tick: number, timestamp: number, entities: Map<string, Entity>): void {
    const snapshot: HistoricalState = {
      tick,
      timestamp,
      entities: new Map(),
    }

    for (const [id, entity] of entities) {
      snapshot.entities.set(id, {
        id,
        x: entity.position.x,
        y: entity.position.y,
        hitboxRadius: entity.hitboxRadius,
        alive: entity.alive,
      })
    }

    this.history.push(snapshot)

    // Prune
    const cutoff = timestamp - this.maxHistoryMs
    while (this.history.length > 0 && this.history[0].timestamp < cutoff) {
      this.history.shift()
    }
  }

  /**
   * Get entity positions at a specific point in time.
   * Interpolates between the two nearest recorded states.
   */
  getStateAtTime(targetTime: number): Map<string, EntitySnapshot> | null {
    if (this.history.length < 2) return null

    let before: HistoricalState | null = null
    let after: HistoricalState | null = null

    for (let i = 0; i < this.history.length - 1; i++) {
      if (this.history[i].timestamp <= targetTime && this.history[i + 1].timestamp >= targetTime) {
        before = this.history[i]
        after = this.history[i + 1]
        break
      }
    }

    if (!before || !after) {
      // targetTime is outside our history window
      return null
    }

    const totalDuration = after.timestamp - before.timestamp
    const elapsed = targetTime - before.timestamp
    const t = elapsed / totalDuration

    // Interpolate all entities
    const result = new Map<string, EntitySnapshot>()
    for (const [id, entityAfter] of after.entities) {
      const entityBefore = before.entities.get(id)
      if (!entityBefore) {
        result.set(id, entityAfter)
        continue
      }

      result.set(id, {
        id,
        x: entityBefore.x + (entityAfter.x - entityBefore.x) * t,
        y: entityBefore.y + (entityAfter.y - entityBefore.y) * t,
        hitboxRadius: entityAfter.hitboxRadius,
        alive: entityAfter.alive,
      })
    }

    return result
  }
}
```

### Lag-Compensated Skillshot Hit Detection

```typescript
// server/src/game/lag-compensation.ts

export class LagCompensation {
  constructor(
    private readonly stateHistory: StateHistory,
    private readonly playerManager: PlayerManager,
  ) {}

  /**
   * Check if a skillshot hits any entity, rewinding to the shooter's
   * perceived time.
   *
   * @param shooterId    Who fired the skillshot
   * @param origin       Skillshot start position
   * @param direction    Normalized direction vector
   * @param width        Skillshot hitbox width
   * @param maxDistance   Skillshot max range
   * @param fireTimestamp Server timestamp when the input was processed
   */
  checkSkillshotHit(
    shooterId: string,
    origin: Vec2,
    direction: Vec2,
    width: number,
    maxDistance: number,
    fireTimestamp: number,
  ): EntitySnapshot | null {
    // Calculate the shooter's effective latency
    const shooterRtt = this.playerManager.getRtt(shooterId)
    const halfRtt = shooterRtt / 2
    const interpolationDelay = 100 // client-side interpolation delay

    // The shooter was seeing the world at this point in time
    const rewindTime = fireTimestamp - halfRtt - interpolationDelay

    // Clamp rewind to prevent abuse (max 300ms rewind)
    const maxRewindMs = 300
    const clampedRewindTime = Math.max(fireTimestamp - maxRewindMs, rewindTime)

    // Get historical entity positions
    const historicalState = this.stateHistory.getStateAtTime(clampedRewindTime)
    if (!historicalState) {
      // No history available, fall back to current state
      return null
    }

    // Check collision against each enemy entity at their historical position
    let closestHit: EntitySnapshot | null = null
    let closestDist = maxDistance

    for (const [entityId, entity] of historicalState) {
      // Don't hit yourself
      if (entityId === shooterId) continue
      // Don't hit dead entities
      if (!entity.alive) continue
      // Don't hit allies (check team -- omitted for brevity)

      const hitDist = this.lineCircleIntersection(
        origin,
        direction,
        { x: entity.x, y: entity.y },
        entity.hitboxRadius + width / 2,
        maxDistance,
      )

      if (hitDist !== null && hitDist < closestDist) {
        closestDist = hitDist
        closestHit = entity
      }
    }

    return closestHit
  }

  /**
   * Ray-circle intersection test.
   * Returns distance to intersection, or null if no hit.
   */
  private lineCircleIntersection(
    rayOrigin: Vec2,
    rayDir: Vec2,
    circleCenter: Vec2,
    circleRadius: number,
    maxDist: number,
  ): number | null {
    const ox = rayOrigin.x - circleCenter.x
    const oy = rayOrigin.y - circleCenter.y

    const a = rayDir.x * rayDir.x + rayDir.y * rayDir.y
    const b = 2 * (ox * rayDir.x + oy * rayDir.y)
    const c = ox * ox + oy * oy - circleRadius * circleRadius

    const discriminant = b * b - 4 * a * c

    if (discriminant < 0) return null

    const sqrtDisc = Math.sqrt(discriminant)
    const t1 = (-b - sqrtDisc) / (2 * a)
    const t2 = (-b + sqrtDisc) / (2 * a)

    // We want the nearest positive intersection within range
    if (t1 >= 0 && t1 <= maxDist) return t1
    if (t2 >= 0 && t2 <= maxDist) return t2

    return null
  }
}
```

### Rewind Budget and Fairness

| Parameter           | Value    | Rationale                                                  |
| ------------------- | -------- | ---------------------------------------------------------- |
| Max rewind          | 300ms    | Prevents high-ping players from shooting "ghosts"          |
| Min rewind          | 0ms      | LAN players get no rewind (they see near-real-time)        |
| Favor shooter       | Yes      | Standard in action games; the shooter should feel accurate |
| Victim notification | Optional | Can show "killed by lag-compensated hit" in death recap    |

---

## 8. Bandwidth Optimization

A 5v5 MOBA with minions, turrets, and projectiles can generate a lot of data. The
target is to stay under **10 KB/s per client** during normal gameplay.

### 8.1 Delta Compression

Only send fields that changed since the last acknowledged snapshot.

```typescript
// server/src/net/delta-compression.ts

interface EntityDelta {
  id: string
  /** Bitmask indicating which fields changed. */
  mask: number
  /** Only populated fields whose bit is set in the mask. */
  x?: number
  y?: number
  health?: number
  mana?: number
  facing?: number
  alive?: boolean
  buffs?: BuffState[]
  animationState?: number
}

// Field bitmask constants
const FIELD_X = 1 << 0 // 0x01
const FIELD_Y = 1 << 1 // 0x02
const FIELD_HEALTH = 1 << 2 // 0x04
const FIELD_MANA = 1 << 3 // 0x08
const FIELD_FACING = 1 << 4 // 0x10
const FIELD_ALIVE = 1 << 5 // 0x20
const FIELD_BUFFS = 1 << 6 // 0x40
const FIELD_ANIMATION = 1 << 7 // 0x80

export class DeltaCompressor {
  /**
   * Last-sent state per client, per entity.
   * Key: `${clientId}:${entityId}`
   */
  private lastSent = new Map<string, EntityState>()

  computeDelta(clientId: string, entityId: string, current: EntityState): EntityDelta | null {
    const key = `${clientId}:${entityId}`
    const prev = this.lastSent.get(key)

    if (!prev) {
      // First time: send full state
      this.lastSent.set(key, { ...current })
      return this.fullDelta(current)
    }

    let mask = 0
    const delta: EntityDelta = { id: entityId, mask: 0 }

    // Compare each field
    if (Math.abs(current.x - prev.x) > 0.1) {
      mask |= FIELD_X
      delta.x = current.x
    }
    if (Math.abs(current.y - prev.y) > 0.1) {
      mask |= FIELD_Y
      delta.y = current.y
    }
    if (current.health !== prev.health) {
      mask |= FIELD_HEALTH
      delta.health = current.health
    }
    if (current.mana !== prev.mana) {
      mask |= FIELD_MANA
      delta.mana = current.mana
    }
    if (Math.abs(current.facing - prev.facing) > 0.01) {
      mask |= FIELD_FACING
      delta.facing = current.facing
    }
    if (current.alive !== prev.alive) {
      mask |= FIELD_ALIVE
      delta.alive = current.alive
    }

    if (mask === 0) return null // nothing changed

    delta.mask = mask
    this.lastSent.set(key, { ...current })
    return delta
  }

  private fullDelta(state: EntityState): EntityDelta {
    return {
      id: state.id,
      mask: 0xff, // all fields
      x: state.x,
      y: state.y,
      health: state.health,
      mana: state.mana,
      facing: state.facing,
      alive: state.alive,
      buffs: state.buffs,
      animationState: state.animationState,
    }
  }
}
```

### 8.2 Fog of War Server-Side Filtering

The server must never send enemy positions that the client shouldn't know about. This
prevents maphack cheats at the protocol level.

```typescript
// server/src/net/fog-of-war-filter.ts

export class FogOfWarFilter {
  constructor(private readonly visionSystem: VisionSystem) {}

  /**
   * Filter a snapshot to only include entities visible to the given team.
   */
  filterForTeam(
    fullSnapshot: SnapshotPayload,
    teamId: number,
    playerChampionId: string,
  ): SnapshotPayload {
    return {
      champions: fullSnapshot.champions.filter(
        (c) => c.team === teamId || this.visionSystem.isVisibleToTeam(c.id, teamId),
      ),
      minions: fullSnapshot.minions.filter(
        (m) => m.team === teamId || this.visionSystem.isVisibleToTeam(m.id, teamId),
      ),
      projectiles: fullSnapshot.projectiles.filter(
        (p) => p.team === teamId || this.visionSystem.isVisibleToTeam(p.id, teamId),
      ),
      turrets: fullSnapshot.turrets, // turrets are always visible
    }
  }
}

export class VisionSystem {
  private visionSources = new Map<string, VisionSource[]>()

  /**
   * Check if an entity is visible to a team.
   * An entity is visible if it's within vision range of ANY friendly
   * vision source (champion, minion, ward, turret).
   */
  isVisibleToTeam(entityId: string, teamId: number): boolean {
    const entity = this.getEntity(entityId)
    if (!entity || !entity.alive) return false

    const sources = this.visionSources.get(String(teamId)) ?? []
    for (const source of sources) {
      const dx = entity.x - source.x
      const dy = entity.y - source.y
      const distSq = dx * dx + dy * dy
      const rangeSq = source.visionRange * source.visionRange

      if (distSq <= rangeSq) {
        // Additional check: line-of-sight (wall occlusion) if needed
        return true
      }
    }

    return false
  }

  // ... entity/source management methods
  private getEntity(_id: string): EntitySnapshot | null {
    // Look up in current world state
    return null // stub
  }
}
```

### 8.3 Interest Management

Even within fog-of-war visible entities, some are too far away to matter. Area of
Interest (AoI) filtering reduces bandwidth by only sending nearby entities at full
fidelity.

```typescript
// server/src/net/interest-management.ts

interface InterestZone {
  /** Full update rate (every tick). */
  nearRange: number
  /** Reduced update rate (every 3rd tick). */
  midRange: number
  /** Minimal updates (every 10th tick). */
  farRange: number
}

export class InterestManager {
  private readonly zones: InterestZone = {
    nearRange: 1500, // ~screen width + margin
    midRange: 3000, // two screens away
    farRange: 5000, // edge of ARAM lane
  }

  /**
   * Determine how often an entity should be sent to a specific client.
   * Returns: ticks between updates (1 = every tick, 3 = every 3rd, etc.)
   */
  getUpdateFrequency(playerPos: Vec2, entityPos: Vec2, currentTick: number): number {
    const dx = entityPos.x - playerPos.x
    const dy = entityPos.y - playerPos.y
    const distSq = dx * dx + dy * dy

    if (distSq <= this.zones.nearRange ** 2) {
      return 1 // every tick
    }
    if (distSq <= this.zones.midRange ** 2) {
      return 3 // every 3rd tick (~100ms)
    }
    if (distSq <= this.zones.farRange ** 2) {
      return 10 // every 10th tick (~333ms)
    }

    return 0 // don't send at all (beyond maximum range)
  }

  /**
   * Filter entities for a specific player at the current tick.
   */
  filterEntities(playerPos: Vec2, entities: EntityState[], currentTick: number): EntityState[] {
    return entities.filter((entity) => {
      const freq = this.getUpdateFrequency(playerPos, { x: entity.x, y: entity.y }, currentTick)
      return freq > 0 && currentTick % freq === 0
    })
  }
}
```

### 8.4 Binary Serialization with MessagePack

```typescript
// shared/src/protocol/binary-codec.ts

import { encode, decode, ExtensionCodec } from '@msgpack/msgpack'

/**
 * Custom extension types for game-specific compact encoding.
 */
const extensionCodec = new ExtensionCodec()

// Extension type 1: Vec2 (packed as two Float32 = 8 bytes instead of ~30 for JSON)
extensionCodec.register({
  type: 1,
  encode: (object: unknown): Uint8Array | null => {
    if (typeof object === 'object' && object !== null && 'x' in object && 'y' in object) {
      const vec = object as Vec2
      const buf = new ArrayBuffer(8)
      const view = new DataView(buf)
      view.setFloat32(0, vec.x, true)
      view.setFloat32(4, vec.y, true)
      return new Uint8Array(buf)
    }
    return null
  },
  decode: (data: Uint8Array): Vec2 => {
    const view = new DataView(data.buffer, data.byteOffset)
    return {
      x: view.getFloat32(0, true),
      y: view.getFloat32(4, true),
    }
  },
})

export class BinaryCodec {
  static encodeMessage(msg: ServerMessage): Uint8Array {
    return encode(msg, { extensionCodec }) as Uint8Array
  }

  static decodeMessage(data: Uint8Array): ClientMessage {
    return decode(data, { extensionCodec }) as ClientMessage
  }
}
```

### Bandwidth Budget

| Category                  | Per Entity Per Tick | Notes                            |
| ------------------------- | ------------------- | -------------------------------- |
| Position (x, y)           | 8 bytes             | Two Float32                      |
| Health + Mana             | 4 bytes             | Two UInt16 (0-65535)             |
| Facing angle              | 2 bytes             | UInt16 (0-65535 mapped to 0-2pi) |
| Flags (alive, etc.)       | 1 byte              | Bitmask                          |
| Entity ID                 | 2 bytes             | UInt16 index                     |
| **Full entity**           | **~17 bytes**       | Without delta compression        |
| **Delta (position only)** | **~11 bytes**       | Header + changed fields          |

**Estimated bandwidth per client (ARAM, 10 champions + ~30 minions + projectiles):**

```
 Full snapshot every tick:   ~50 entities * 17 bytes * 30 ticks/s = ~25 KB/s
 With delta compression:     ~30 changed * 11 bytes * 30 ticks/s = ~10 KB/s
 With interest management:   ~20 nearby  * 11 bytes * 30 ticks/s = ~6.6 KB/s
 With FoW filtering:         ~15 visible * 11 bytes * 30 ticks/s = ~5 KB/s
```

---

## 9. Connection Handling

WebSocket connections drop. Players Alt+F4. Browsers crash. The game must handle
all of these gracefully.

### Connection State Machine

```
                     +-------------------+
                     |   DISCONNECTED    |
                     +-------------------+
                              |
                   WebSocket connects
                              |
                              v
                     +-------------------+
                     |  AUTHENTICATING   |--- auth fails ---> DISCONNECTED
                     +-------------------+
                              |
                         auth success
                              |
                              v
                     +-------------------+
                     |    CONNECTED      |<------- reconnect success
                     +-------------------+                |
                         |          |                     |
                    normal op    connection lost           |
                         |          |                     |
                         v          v                     |
                     +-------------------+                |
                     |   RECONNECTING    |--- timeout --->+---> ABANDONED
                     +-------------------+                      (bot takes over)
```

### Timeout and Reconnection

```typescript
// server/src/game/connection-manager.ts

interface PlayerConnection {
  playerId: string
  socket: Socket | null
  state: 'connected' | 'reconnecting' | 'abandoned'
  lastHeartbeat: number
  reconnectToken: string // opaque token for reconnect auth
  disconnectedAt: number | null
}

export class ConnectionManager {
  /** How often the client must send a heartbeat. */
  private static readonly HEARTBEAT_INTERVAL_MS = 5_000

  /** Grace period before a disconnect is detected. */
  private static readonly HEARTBEAT_TIMEOUT_MS = 10_000

  /** Time allowed for reconnection before bot takeover. */
  private static readonly RECONNECT_WINDOW_MS = 60_000 // 1 minute

  private connections = new Map<string, PlayerConnection>()

  /**
   * Called every tick to check for stale connections.
   */
  checkConnections(now: number): void {
    for (const [playerId, conn] of this.connections) {
      if (conn.state === 'connected') {
        // Check heartbeat timeout
        if (now - conn.lastHeartbeat > ConnectionManager.HEARTBEAT_TIMEOUT_MS) {
          this.onPlayerDisconnected(playerId, now)
        }
      } else if (conn.state === 'reconnecting') {
        // Check reconnect timeout
        if (
          conn.disconnectedAt &&
          now - conn.disconnectedAt > ConnectionManager.RECONNECT_WINDOW_MS
        ) {
          this.onPlayerAbandoned(playerId)
        }
      }
    }
  }

  private onPlayerDisconnected(playerId: string, now: number): void {
    const conn = this.connections.get(playerId)
    if (!conn) return

    conn.state = 'reconnecting'
    conn.socket = null
    conn.disconnectedAt = now

    // The champion stops moving but stays in place.
    // Inputs are no longer processed for this player.
    this.gameService.freezeChampion(playerId)

    // Notify other players
    this.broadcaster.broadcast({
      type: ServerMessageType.PLAYER_STATUS,
      tick: this.currentTick,
      timestamp: now,
      payload: { playerId, status: 'disconnected' },
    })
  }

  private onPlayerAbandoned(playerId: string): void {
    const conn = this.connections.get(playerId)
    if (!conn) return

    conn.state = 'abandoned'

    // Bot takes over the champion
    this.botManager.activateBotForPlayer(playerId)

    this.broadcaster.broadcast({
      type: ServerMessageType.PLAYER_STATUS,
      tick: this.currentTick,
      timestamp: Date.now(),
      payload: { playerId, status: 'abandoned' },
    })
  }

  /**
   * Handle reconnection attempt.
   */
  attemptReconnect(socket: Socket, token: string): boolean {
    // Find the connection by reconnect token
    for (const [playerId, conn] of this.connections) {
      if (conn.reconnectToken === token && conn.state === 'reconnecting') {
        conn.socket = socket
        conn.state = 'connected'
        conn.lastHeartbeat = Date.now()
        conn.disconnectedAt = null

        // Send full state snapshot so the client can rebuild
        const fullSnapshot = this.snapshotManager.captureFullSnapshot(this.currentTick)
        socket.emit(
          'state',
          MessageCodec.encode({
            type: ServerMessageType.SNAPSHOT,
            tick: this.currentTick,
            timestamp: Date.now(),
            payload: fullSnapshot,
          }),
        )

        // Unfreeze champion
        this.gameService.unfreezeChampion(playerId)

        // Deactivate bot if one took over
        this.botManager.deactivateBotForPlayer(playerId)

        return true
      }
    }

    return false
  }

  // stub references
  private gameService: any
  private broadcaster: any
  private botManager: any
  private snapshotManager: any
  private currentTick = 0
}
```

### Client Reconnection

```typescript
// client/src/net/connection.ts

export class ServerConnection {
  private socket: WebSocket | null = null
  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 10
  private reconnectToken: string | null = null

  estimatedServerTick = 0

  connect(url: string, authToken: string): void {
    this.socket = new WebSocket(url)
    this.socket.binaryType = 'arraybuffer'

    this.socket.onopen = () => {
      this.socket!.send(
        JSON.stringify({
          type: 'auth',
          token: authToken,
          reconnectToken: this.reconnectToken,
        }),
      )
      this.reconnectAttempts = 0
    }

    this.socket.onclose = () => {
      this.scheduleReconnect(url, authToken)
    }

    this.socket.onerror = () => {
      // onclose will fire after onerror
    }

    this.socket.onmessage = (event) => {
      this.handleMessage(event.data)
    }
  }

  private scheduleReconnect(url: string, authToken: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.onReconnectFailed()
      return
    }

    // Exponential backoff with jitter: 1s, 2s, 4s, 8s... up to 30s
    const baseDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000)
    const jitter = Math.random() * 1000
    const delay = baseDelay + jitter

    this.reconnectAttempts++

    setTimeout(() => {
      this.connect(url, authToken)
    }, delay)
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(BinaryCodec.encodeMessage(msg as any))
    }
    // If not connected, drop the message. Stale inputs are useless.
  }

  private handleMessage(data: ArrayBuffer): void {
    /* ... */
  }
  private onReconnectFailed(): void {
    /* show UI: "Connection lost" */
  }
}
```

### What Happens on Disconnect (Summary)

| Event                   | Client                               | Server                    | Other Players See              |
| ----------------------- | ------------------------------------ | ------------------------- | ------------------------------ |
| **Packet loss (brief)** | Slight stutter, extrapolation        | Processes buffered inputs | Might see entity pause briefly |
| **Disconnect detected** | Reconnect dialog shown               | Champion frozen in place  | "[Player] disconnected"        |
| **Reconnect (< 60s)**   | Full snapshot received, game resumes | Unfreeze champion         | "[Player] reconnected"         |
| **Abandon (> 60s)**     | Redirect to results screen           | Bot controls champion     | "[Player] left (bot active)"   |

---

## 10. Anti-Cheat Considerations

Because this is a web-based game, the client is fully exposed (DevTools, memory
inspection, network interception). The **only reliable defense is server-side
validation**. Client-side checks are cosmetic deterrents only.

### Validation Categories

```
 +---------------------------------------------------------------+
 |                    SERVER VALIDATES                            |
 |                                                               |
 |  [Movement]      [Abilities]      [Attacks]      [Economy]   |
 |  - Speed cap     - Cooldowns      - Range         - Gold      |
 |  - Wall clip     - Mana cost      - Attack speed  - Items     |
 |  - Path valid    - Range          - Target valid  - Shop dist |
 |  - Teleport      - Cast time      - Line of sight             |
 |    detection     - Target valid                               |
 +---------------------------------------------------------------+
```

### Movement Validation

```typescript
// server/src/game/validation/movement-validator.ts

export class MovementValidator {
  /** Maximum distance a champion can move in one tick, with tolerance. */
  private static readonly SPEED_TOLERANCE = 1.15 // 15% tolerance for float precision

  /**
   * Validate that a champion has not moved faster than their movement speed allows.
   * Called each tick AFTER processing movement.
   */
  validateMovement(champion: Champion, previousPosition: Vec2, dt: number): boolean {
    const maxDistance = champion.movementSpeed * dt * MovementValidator.SPEED_TOLERANCE

    const actualDistance = Vec2.distance(previousPosition, champion.position)

    if (actualDistance > maxDistance) {
      // Possible speed hack. Reject the movement.
      champion.position = { ...previousPosition }
      this.logViolation(champion.id, 'SPEED_HACK', {
        expected: maxDistance,
        actual: actualDistance,
      })
      return false
    }

    // Check wall collision (champion should not be inside a wall)
    if (this.collisionMap.isInsideWall(champion.position, champion.hitboxRadius)) {
      champion.position = { ...previousPosition }
      this.logViolation(champion.id, 'WALL_CLIP', {
        position: champion.position,
      })
      return false
    }

    return true
  }

  // Check if a move target is in bounds
  validateMoveTarget(target: Vec2): boolean {
    return (
      target.x >= 0 &&
      target.x <= this.mapWidth &&
      target.y >= 0 &&
      target.y <= this.mapHeight &&
      !this.collisionMap.isInsideWall(target, 0)
    )
  }

  private logViolation(championId: string, type: string, details: Record<string, unknown>): void {
    // Log to anti-cheat service for review
  }

  private collisionMap: any
  private mapWidth = 15000
  private mapHeight = 15000
}
```

### Ability Validation

```typescript
// server/src/game/validation/ability-validator.ts

export class AbilityValidator {
  /**
   * Validate that a champion can cast the requested ability.
   * Returns a rejection reason or null if valid.
   */
  validateAbilityCast(champion: Champion, slot: number, target: Vec2 | string): string | null {
    // --- Existence checks ---
    const ability = champion.abilities[slot]
    if (!ability) return 'INVALID_SLOT'

    // --- State checks ---
    if (!champion.alive) return 'DEAD'
    if (champion.isSilenced()) return 'SILENCED'
    if (champion.isStunned()) return 'STUNNED'
    if (champion.isCasting()) return 'ALREADY_CASTING'

    // --- Cooldown check ---
    if (champion.cooldowns[slot] > 0) {
      this.logViolation(champion.id, 'COOLDOWN_HACK', {
        slot,
        remainingCd: champion.cooldowns[slot],
      })
      return 'ON_COOLDOWN'
    }

    // --- Mana check ---
    if (champion.mana < ability.manaCost) return 'NO_MANA'

    // --- Range check ---
    if (typeof target === 'string') {
      // Targeted ability: check distance to target entity
      const targetEntity = this.entityManager.get(target)
      if (!targetEntity) return 'INVALID_TARGET'
      if (!targetEntity.alive) return 'TARGET_DEAD'

      const dist = Vec2.distance(champion.position, targetEntity.position)
      if (dist > ability.range + ability.rangeTolerance) {
        return 'OUT_OF_RANGE'
      }
    } else {
      // Skillshot: check that target direction is within ability range
      const dist = Vec2.distance(champion.position, target)
      if (dist > ability.range * 1.5) {
        // Allow some tolerance since the client may extrapolate the target
        return 'OUT_OF_RANGE'
      }
    }

    return null // valid
  }

  private logViolation(id: string, type: string, details: any): void {
    /* ... */
  }
  private entityManager: any
}
```

### Rate Limiting and Anomaly Detection

```typescript
// server/src/game/validation/rate-limiter.ts

export class InputRateLimiter {
  /** Maximum inputs per second per player. */
  private static readonly MAX_INPUTS_PER_SECOND = 30

  /** Maximum inputs per tick per player (prevent input flooding). */
  private static readonly MAX_INPUTS_PER_TICK = 3

  private inputCounts = new Map<string, { count: number; windowStart: number }>()

  /**
   * Check if a player is sending too many inputs.
   * Returns true if the input should be accepted.
   */
  allow(playerId: string, now: number): boolean {
    let record = this.inputCounts.get(playerId)
    if (!record) {
      record = { count: 0, windowStart: now }
      this.inputCounts.set(playerId, record)
    }

    // Reset window every second
    if (now - record.windowStart >= 1000) {
      record.count = 0
      record.windowStart = now
    }

    record.count++

    if (record.count > InputRateLimiter.MAX_INPUTS_PER_SECOND) {
      // Possible bot or macro. Log and reject.
      return false
    }

    return true
  }

  /**
   * Filter excess inputs per tick from a single player.
   */
  filterPerTick(inputs: QueuedInput[]): QueuedInput[] {
    const perPlayer = new Map<string, QueuedInput[]>()

    for (const input of inputs) {
      const list = perPlayer.get(input.playerId) ?? []
      list.push(input)
      perPlayer.set(input.playerId, list)
    }

    const result: QueuedInput[] = []
    for (const [, playerInputs] of perPlayer) {
      // Take only the last N inputs per tick (most recent are most relevant)
      const limited = playerInputs.slice(-InputRateLimiter.MAX_INPUTS_PER_TICK)
      result.push(...limited)
    }

    return result
  }
}
```

### Summary of Anti-Cheat Checks

| Cheat Type           | Detection                                    | Server Response              |
| -------------------- | -------------------------------------------- | ---------------------------- |
| **Speed hack**       | Distance per tick exceeds max movement speed | Reject move, revert position |
| **Teleport**         | Position jumps impossibly far in one tick    | Revert position, flag player |
| **Cooldown hack**    | Ability cast while cooldown > 0              | Reject cast                  |
| **Mana hack**        | Ability cast with insufficient mana          | Reject cast                  |
| **Range hack**       | Ability/attack target beyond max range       | Reject action                |
| **Wall clip**        | Champion position inside wall geometry       | Revert position              |
| **Fog of war hack**  | N/A (server never sends hidden data)         | Prevented by design          |
| **Gold hack**        | N/A (server controls gold)                   | Prevented by design          |
| **Input flooding**   | Inputs per second exceeds threshold          | Rate limit, drop excess      |
| **Packet tampering** | Malformed or impossible field values         | Reject, log anomaly          |

### What Cannot Be Prevented Client-Side

These require server-side solutions because the browser environment is fully accessible:

- **Zoom hacks**: Camera zoom is client-only; enforce a max zoom server-side by limiting the interest area.
- **Script injection**: The client JS is fully modifiable. All game logic must be validated server-side.
- **Pixel-perfect aiming bots**: Extremely difficult to detect. Rely on behavioral analysis (inhuman reaction times, perfect aim patterns over many games).
- **Information display hacks** (showing cooldown timers, etc.): Only preventable by not sending the data. FoW filtering handles enemy visibility; ally info is intentionally public.

---

## Appendix A: Shared Types

```typescript
// shared/src/types.ts

export interface Vec2 {
  x: number
  y: number
}

export namespace Vec2 {
  export function distance(a: Vec2, b: Vec2): number {
    const dx = b.x - a.x
    const dy = b.y - a.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  export function distanceSq(a: Vec2, b: Vec2): number {
    const dx = b.x - a.x
    const dy = b.y - a.y
    return dx * dx + dy * dy
  }

  export function normalize(v: Vec2): Vec2 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y)
    if (len === 0) return { x: 0, y: 0 }
    return { x: v.x / len, y: v.y / len }
  }

  export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    }
  }
}

export interface BuffState {
  type: string
  remaining: number // ms
  stacks: number
}

export interface EntityState {
  id: string
  entityType: 'champion' | 'minion' | 'turret' | 'projectile'
  x: number
  y: number
  facing: number
  health: number
  maxHealth: number
  alive: boolean
  team: number
  buffs: BuffState[]
  animationState: number
}

export interface PlayerInput {
  type: ClientMessageType
  [key: string]: unknown
}
```

## Appendix B: Clock Synchronization

The client needs a reasonably accurate estimate of the server's current time to
interpolate correctly and timestamp inputs. Use a simple NTP-like approach.

```typescript
// client/src/net/clock-sync.ts

export class ClockSync {
  private offset = 0 // client_time + offset = server_time
  private rtt = 0 // smoothed round-trip time
  private samples: number[] = []
  private readonly maxSamples = 10

  /**
   * Send a ping request with the client's current timestamp.
   */
  sendPing(connection: ServerConnection): void {
    connection.send({
      type: ClientMessageType.PING_REQUEST,
      seq: 0,
      tick: 0,
      payload: { clientTime: performance.now() },
    })
  }

  /**
   * Handle the server's pong response.
   * The server includes its own timestamp and echoes the client's timestamp.
   */
  onPong(clientTimeSent: number, serverTime: number): void {
    const now = performance.now()
    const roundTrip = now - clientTimeSent
    const halfRtt = roundTrip / 2

    // Estimate offset: server_time was `serverTime` at `clientTimeSent + halfRtt`
    const estimatedOffset = serverTime - (clientTimeSent + halfRtt)

    this.samples.push(estimatedOffset)
    if (this.samples.length > this.maxSamples) {
      this.samples.shift()
    }

    // Use median to filter outliers (spikes)
    const sorted = [...this.samples].sort((a, b) => a - b)
    this.offset = sorted[Math.floor(sorted.length / 2)]
    this.rtt = roundTrip
  }

  /** Convert local time to estimated server time. */
  toServerTime(localTime: number): number {
    return localTime + this.offset
  }

  /** Get current estimated server time. */
  get now(): number {
    return performance.now() + this.offset
  }

  /** Get current smoothed RTT. */
  get currentRtt(): number {
    return this.rtt
  }
}
```

## Appendix C: Tick Rate vs. Frame Rate

```
 Server tick rate: 30 Hz (33.33ms per tick)
 Client frame rate: 60 fps (16.67ms per frame)

 For every 1 server tick, the client renders ~2 frames.
 This means the client must interpolate between ticks for smooth visuals.

 Timeline:

 Server:  |---T0---|---T1---|---T2---|---T3---|
          0ms     33ms     66ms     100ms

 Client:  |F0|F1|F2|F3|F4|F5|F6|F7|F8|F9|F10|F11|
          0  16 33 50 66 83 100 ...

 F0,F1 interpolate within T0 -> T1
 F2,F3 interpolate within T1 -> T2
 ...and so on

 The client render loop:

   function gameLoop(timestamp: number) {
     const dt = (timestamp - lastFrameTime) / 1000;
     lastFrameTime = timestamp;

     // Update local prediction (movement)
     prediction.updatePrediction(dt);
     reconciliation.updateCorrection();

     // Render all entities (interpolated for remotes, predicted for local)
     entityRenderer.render(clockSync.now, entitySprites);

     // Render UI, particles, effects
     uiRenderer.update(dt);
     particleSystem.update(dt);

     requestAnimationFrame(gameLoop);
   }
```

---

_This document is a living specification. Update it as the implementation evolves._
