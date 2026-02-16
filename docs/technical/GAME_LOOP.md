# Game Loop & Simulation Architecture

## Table of Contents

1. [Overview](#1-overview)
2. [Server Game Loop](#2-server-game-loop)
3. [Client Render Loop](#3-client-render-loop)
4. [Entity State Machine](#4-entity-state-machine)
5. [Animation Timing](#5-animation-timing)
6. [Turn Order / Priority](#6-turn-order--priority)
7. [Game Clock](#7-game-clock)
8. [Match Lifecycle](#8-match-lifecycle)

---

## 1. Overview

The game runs two independent loops that serve fundamentally different purposes:

```
┌───────────────────────────────────────────────────────────────────────┐
│                           SERVER (NestJS)                             │
│                                                                       │
│   Game Loop: 30 Hz (33.33ms per tick)                                │
│   ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐                      │
│   │ T=0 │→ │ T=1 │→ │ T=2 │→ │ T=3 │→ │ T=4 │→ ...                 │
│   └─────┘  └─────┘  └─────┘  └─────┘  └─────┘                      │
│       │        │        │        │        │                           │
│       ▼        ▼        ▼        ▼        ▼        Snapshots sent    │
│      [S0]     [S1]     [S2]     [S3]     [S4]      via WebSocket     │
│       │        │        │        │        │                           │
└───────┼────────┼────────┼────────┼────────┼──────────────────────────┘
        │        │        │        │        │
        ▼        ▼        ▼        ▼        ▼
┌───────────────────────────────────────────────────────────────────────┐
│                         CLIENT (PixiJS)                               │
│                                                                       │
│   Render Loop: 60 fps (16.67ms per frame)                            │
│   ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐                │
│   │F0││F1││F2││F3││F4││F5││F6││F7││F8││F9││..││..│                │
│   └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘                │
│                                                                       │
│   Interpolates between snapshots for smooth visuals                   │
└───────────────────────────────────────────────────────────────────────┘
```

### Why Two Different Rates?

| Aspect          | Server (30 Hz)                                      | Client (60 fps)                               |
| --------------- | --------------------------------------------------- | --------------------------------------------- |
| **Purpose**     | Authoritative game logic                            | Display and user interaction                  |
| **Rate**        | 33.33ms per tick                                    | 16.67ms per frame                             |
| **Determinism** | Must be deterministic across all clients            | Only needs to look smooth                     |
| **Cost**        | Expensive (physics, AI, collision for all entities) | Cheap per-frame (just rendering)              |
| **Bandwidth**   | Each tick produces a snapshot to broadcast          | Receives snapshots, interpolates between them |

**30 Hz for the server** is the sweet spot. It is fast enough that gameplay feels responsive (a player's input is processed within at most 33ms of the next tick), but slow enough that the server can handle all 10 players, all minions, projectiles, and AI within a single tick budget. Doubling to 60 Hz would double the CPU cost and network bandwidth for a marginal improvement that players cannot perceive.

**60 fps for the client** is the standard for smooth visual rendering. The human eye perceives motion at 60 fps as fluid. The client interpolates entity positions between the two most recent server snapshots, producing smooth movement even though the server only updates 30 times per second.

---

## 2. Server Game Loop

### 2.1 Fixed Timestep

The server loop runs at a **fixed timestep** of 33.33ms (30 ticks per second). Every tick simulates exactly `TICK_DURATION_MS` of game time regardless of how long the tick actually takes to compute. This guarantees determinism: tick 1000 always represents exactly 33.33 seconds of game time.

```typescript
// packages/shared/src/constants/tick.ts

export const TICK_RATE = 30
export const TICK_DURATION_MS = 1000 / TICK_RATE // 33.33ms
export const TICK_DURATION_S = 1 / TICK_RATE // 0.03333s
```

### 2.2 The Tick Cycle

Each tick executes the following phases in strict order:

```
┌─────────────────────────────────────── One Tick (33.33ms budget) ──────────────────────────────────────┐
│                                                                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Collect   │→ │ Process  │→ │ Update   │→ │ Update   │→ │ Update   │→ │ Check    │→ │ Update     │  │
│  │ Inputs    │  │ Inputs   │  │ Movement │  │ Abilities│  │ Projecti-│  │ Colli-   │  │ Minion AI  │  │
│  │           │  │          │  │          │  │ Cooldowns│  │ les      │  │ sions    │  │            │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
│                                                                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                                               │
│  │ Update   │→ │ Check    │→ │ Capture  │→ │Broadcast │                                               │
│  │ Turret AI│  │ Death &  │  │ Snapshot │  │ State    │                                               │
│  │          │  │ Respawn  │  │          │  │          │                                               │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘                                               │
│                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Phase breakdown:**

| #   | Phase                            | Description                                                                                                                                                                |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Collect Inputs**               | Drain the input queue. All player commands received since the last tick are gathered.                                                                                      |
| 2   | **Process Inputs**               | Validate and apply each input: move commands, attack commands, ability casts, item purchases. Invalid inputs (out of range, on cooldown) are silently dropped.             |
| 3   | **Update Movement**              | Advance all moving entities along their paths by `movementSpeed * TICK_DURATION_S` units. Apply dashes and knockbacks.                                                     |
| 4   | **Update Abilities & Cooldowns** | Tick down all cooldowns by `TICK_DURATION_S`. Advance cast timers, channel timers. Apply buff/debuff durations. Recalculate stats after buff changes.                      |
| 5   | **Update Projectiles**           | Move all in-flight projectiles. Check if any projectile has reached its target or max range.                                                                               |
| 6   | **Check Collisions**             | Detect projectile-entity collisions, entity-entity collisions (pathing), entity-structure collisions. Apply damage from projectile hits.                                   |
| 7   | **Update Minion AI**             | Each minion evaluates its target priority, acquires targets, and queues its next action (move toward target, begin auto-attack).                                           |
| 8   | **Update Turret AI**             | Each turret evaluates targeting priority and fires if a target is in range and the attack cooldown has elapsed.                                                            |
| 9   | **Check Death & Respawn**        | Any entity at 0 HP transitions to Dead state. Champions get a respawn timer. Structures are marked as destroyed. Check for respawning champions whose timers have expired. |
| 10  | **Capture Snapshot**             | Serialize the full game state into a snapshot tagged with the current tick number.                                                                                         |
| 11  | **Broadcast State**              | Send the snapshot (or a delta) to all connected clients via WebSocket. Each client only receives data about entities within their team's vision.                           |

### 2.3 GameLoop Implementation

```typescript
// apps/api/src/modules/game/core/game-loop.ts

import { Logger } from '@nestjs/common'
import { TICK_RATE, TICK_DURATION_MS } from '@league/shared'
import { GameState } from './game-state'
import { InputQueue } from './input-queue'
import { SnapshotManager } from './snapshot-manager'
import { BroadcastService } from '../network/broadcast.service'

export class GameLoop {
  private readonly logger = new Logger(GameLoop.name)

  private running = false
  private tickNumber = 0
  private gameTimeMs = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  // Tracks real-world time to detect drift and catch up
  private lastTickRealTime = 0
  private accumulatedLagMs = 0

  // Maximum number of ticks to simulate in a single catch-up burst.
  // Prevents a "spiral of death" where the server falls further behind.
  private static readonly MAX_CATCH_UP_TICKS = 3

  constructor(
    private readonly state: GameState,
    private readonly inputQueue: InputQueue,
    private readonly snapshotManager: SnapshotManager,
    private readonly broadcastService: BroadcastService,
  ) {}

  start(): void {
    if (this.running) return

    this.running = true
    this.lastTickRealTime = performance.now()
    this.accumulatedLagMs = 0

    this.logger.log(`Game loop started at ${TICK_RATE} Hz`)
    this.scheduleNextTick()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.logger.log(`Game loop stopped at tick ${this.tickNumber}`)
  }

  private scheduleNextTick(): void {
    if (!this.running) return

    const now = performance.now()
    const elapsed = now - this.lastTickRealTime
    this.lastTickRealTime = now

    // Accumulate real elapsed time
    this.accumulatedLagMs += elapsed

    // Simulate as many fixed-timestep ticks as we have budget for
    let ticksSimulated = 0
    while (
      this.accumulatedLagMs >= TICK_DURATION_MS &&
      ticksSimulated < GameLoop.MAX_CATCH_UP_TICKS
    ) {
      this.executeTick()
      this.accumulatedLagMs -= TICK_DURATION_MS
      ticksSimulated++
    }

    // If we hit the catch-up limit, discard remaining lag to avoid spiral of death
    if (this.accumulatedLagMs >= TICK_DURATION_MS) {
      const droppedTicks = Math.floor(this.accumulatedLagMs / TICK_DURATION_MS)
      this.logger.warn(
        `Server overloaded: dropping ${droppedTicks} ticks at tick ${this.tickNumber}`,
      )
      this.accumulatedLagMs = this.accumulatedLagMs % TICK_DURATION_MS
    }

    // Schedule next wake-up for the remaining time in this tick period
    const sleepMs = Math.max(1, TICK_DURATION_MS - this.accumulatedLagMs)
    this.timer = setTimeout(() => this.scheduleNextTick(), sleepMs)
  }

  private executeTick(): void {
    const tickStart = performance.now()

    this.tickNumber++
    this.gameTimeMs += TICK_DURATION_MS

    // === Phase 1 & 2: Collect and process player inputs ===
    const inputs = this.inputQueue.drain()
    this.state.processInputs(inputs, this.tickNumber)

    // === Phase 3: Update movement ===
    this.state.updateMovement(TICK_DURATION_MS)

    // === Phase 4: Update abilities, cooldowns, buffs ===
    this.state.updateAbilities(TICK_DURATION_MS)

    // === Phase 5: Update projectiles ===
    this.state.updateProjectiles(TICK_DURATION_MS)

    // === Phase 6: Check collisions ===
    this.state.checkCollisions()

    // === Phase 7: Update minion AI ===
    this.state.updateMinionAI(this.tickNumber)

    // === Phase 8: Update turret AI ===
    this.state.updateTurretAI(this.tickNumber)

    // === Phase 9: Check death and respawn ===
    this.state.checkDeathAndRespawn(this.gameTimeMs)

    // === Phase 10: Capture snapshot ===
    const snapshot = this.snapshotManager.capture(this.state, this.tickNumber, this.gameTimeMs)

    // === Phase 11: Broadcast ===
    this.broadcastService.sendSnapshot(snapshot)

    // Track tick performance
    const tickDuration = performance.now() - tickStart
    if (tickDuration > TICK_DURATION_MS * 0.8) {
      this.logger.warn(
        `Tick ${this.tickNumber} took ${tickDuration.toFixed(1)}ms ` +
          `(${((tickDuration / TICK_DURATION_MS) * 100).toFixed(0)}% of budget)`,
      )
    }
  }

  // --- Accessors ---

  getTickNumber(): number {
    return this.tickNumber
  }

  getGameTimeMs(): number {
    return this.gameTimeMs
  }

  isRunning(): boolean {
    return this.running
  }
}
```

### 2.4 Handling Overlong Ticks

When a tick takes longer than 33.33ms to execute (e.g., due to a GC pause or a particularly heavy frame with many entities), the server uses an **accumulator-based catch-up strategy**:

```
Normal operation (tick takes ~10ms):
  Real time:  |---10ms---|------23ms idle------|---10ms---|
  Sim time:   [== tick ==]                     [== tick ==]

Overrun (tick takes 50ms):
  Real time:  |----------50ms----------|---10ms---|---10ms---|
  Sim time:   [====== tick ======]     [= tick =] [= tick =]
                                        ↑ catch-up tick

Severe overrun (tick takes 150ms+):
  Real time:  |-----------150ms+--------------|---10ms---|
  Sim time:   [======= tick =======]          [= tick =] × up to 3
              [remaining lag DROPPED]          ↑ capped catch-up
```

**Rules:**

1. **Accumulate** real elapsed time since the last scheduling call.
2. **Simulate** up to `MAX_CATCH_UP_TICKS` (3) ticks per scheduling cycle.
3. **Discard** any remaining accumulated lag beyond that limit. This prevents a "spiral of death" where the server is perpetually behind and never catches up.
4. **Log a warning** whenever ticks are dropped so the issue can be investigated.

### 2.5 Tick Numbering

Every tick increments a monotonically increasing `tickNumber` starting at 1. This number is embedded in every snapshot and every client input.

```typescript
// Snapshot sent to clients
interface GameSnapshot {
  tick: number // e.g. 1500
  gameTimeMs: number // e.g. 50000 (50 seconds)
  entities: EntitySnapshot[]
  events: GameEvent[] // kills, tower destroyed, etc.
}

// Input sent from client
interface PlayerInput {
  type: 'move' | 'attack' | 'cast_ability' | 'stop' | 'buy_item'
  clientTick: number // the tick the client thinks it is at
  sequenceId: number // monotonic per-player, for input acknowledgement
  payload: unknown // command-specific data
}
```

The client includes `clientTick` in every input so the server can order inputs correctly and the client can reconcile prediction after receiving acknowledgement.

---

## 3. Client Render Loop

### 3.1 Architecture

The client render loop runs via `requestAnimationFrame` at the display's refresh rate (typically 60 fps). It does not simulate game logic. Instead, it:

1. Reads user input (mouse, keyboard).
2. Sends input commands to the server.
3. Interpolates entity positions between the two most recent server snapshots.
4. Renders sprites, particles, and effects via PixiJS.
5. Updates UI overlays (cooldowns, health bars, minimap, game clock).

```
Client Frame Pipeline:
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  ┌───────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────────┐ │
│  │ Handle    │→ │ Interpolate  │→ │ Render     │→ │ Update UI   │ │
│  │ Input     │  │ Entities     │  │ Scene      │  │ Overlays    │ │
│  └───────────┘  └──────────────┘  └────────────┘  └─────────────┘ │
│       │                                                             │
│       ▼                                                             │
│  Send to server                                                     │
│  via WebSocket                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Snapshot Interpolation

The client maintains a buffer of the two most recent server snapshots and interpolates between them. This introduces a deliberate **rendering delay** of one tick (~33ms) to ensure there is always a "from" and "to" snapshot to interpolate between.

```typescript
// apps/web/src/game/network/snapshot-buffer.ts

import { GameSnapshot, EntitySnapshot } from '@league/shared'

export class SnapshotBuffer {
  private snapshots: GameSnapshot[] = []
  private readonly bufferSize = 3 // keep a few snapshots for jitter tolerance

  push(snapshot: GameSnapshot): void {
    this.snapshots.push(snapshot)
    // Keep only the most recent snapshots
    if (this.snapshots.length > this.bufferSize) {
      this.snapshots.shift()
    }
  }

  /**
   * Returns the two snapshots to interpolate between and the
   * interpolation factor (0..1).
   *
   * renderTimeMs is the server game time the client wants to display,
   * typically "latest server time minus one tick" for smooth interpolation.
   */
  getInterpolationState(renderTimeMs: number): {
    from: GameSnapshot
    to: GameSnapshot
    alpha: number
  } | null {
    if (this.snapshots.length < 2) return null

    // Find the two snapshots that bracket renderTimeMs
    for (let i = this.snapshots.length - 1; i >= 1; i--) {
      const to = this.snapshots[i]
      const from = this.snapshots[i - 1]

      if (from.gameTimeMs <= renderTimeMs && renderTimeMs <= to.gameTimeMs) {
        const range = to.gameTimeMs - from.gameTimeMs
        const alpha = range > 0 ? (renderTimeMs - from.gameTimeMs) / range : 0
        return { from, to, alpha }
      }
    }

    // If renderTimeMs is ahead of all snapshots, extrapolate from the last two
    const from = this.snapshots[this.snapshots.length - 2]
    const to = this.snapshots[this.snapshots.length - 1]
    const range = to.gameTimeMs - from.gameTimeMs
    const alpha = range > 0 ? (renderTimeMs - from.gameTimeMs) / range : 1

    return { from, to, alpha: Math.min(alpha, 1.5) } // clamp extrapolation
  }
}
```

### 3.3 Client Loop Implementation

```typescript
// apps/web/src/game/core/client-loop.ts

import { Application, Ticker } from 'pixi.js'
import { SnapshotBuffer } from '../network/snapshot-buffer'
import { InputManager } from '../input/input-manager'
import { EntityRenderer } from '../rendering/entity-renderer'
import { ParticleManager } from '../rendering/particle-manager'
import { UIManager } from '../ui/ui-manager'
import { CameraController } from '../rendering/camera-controller'
import { NetworkClient } from '../network/network-client'
import { TICK_DURATION_MS } from '@league/shared'

export class ClientLoop {
  // Render delay: we render one tick behind the latest server state
  // to always have two snapshots to interpolate between.
  private static readonly INTERPOLATION_DELAY_MS = TICK_DURATION_MS

  private serverTimeOffsetMs = 0 // local time - server time
  private latestServerTimeMs = 0

  constructor(
    private readonly app: Application,
    private readonly snapshotBuffer: SnapshotBuffer,
    private readonly inputManager: InputManager,
    private readonly entityRenderer: EntityRenderer,
    private readonly particleManager: ParticleManager,
    private readonly uiManager: UIManager,
    private readonly camera: CameraController,
    private readonly network: NetworkClient,
  ) {}

  start(): void {
    // PixiJS v8 Ticker drives the render loop at display refresh rate
    this.app.ticker.add(this.onFrame, this)
  }

  stop(): void {
    this.app.ticker.remove(this.onFrame, this)
  }

  /**
   * Called by PixiJS Ticker on every requestAnimationFrame.
   * deltaTime is in milliseconds (Ticker.deltaMS).
   */
  private onFrame(ticker: Ticker): void {
    const deltaMs = ticker.deltaMS

    // === Step 1: Handle user input ===
    const commands = this.inputManager.poll()
    for (const cmd of commands) {
      this.network.sendInput(cmd)
    }

    // === Step 2: Calculate render time (one tick behind latest) ===
    const renderTimeMs = this.latestServerTimeMs - ClientLoop.INTERPOLATION_DELAY_MS

    // === Step 3: Interpolate entity positions ===
    const interpState = this.snapshotBuffer.getInterpolationState(renderTimeMs)

    if (interpState) {
      const { from, to, alpha } = interpState

      // Interpolate each entity
      for (const toEntity of to.entities) {
        const fromEntity = from.entities.find((e) => e.id === toEntity.id)

        if (fromEntity) {
          const interpX = fromEntity.x + (toEntity.x - fromEntity.x) * alpha
          const interpY = fromEntity.y + (toEntity.y - fromEntity.y) * alpha

          this.entityRenderer.updateEntity(toEntity.id, {
            x: interpX,
            y: interpY,
            state: toEntity.state,
            hp: toEntity.hp,
            maxHp: toEntity.maxHp,
            facing: toEntity.facing,
          })
        } else {
          // New entity appeared — snap to position
          this.entityRenderer.spawnEntity(toEntity)
        }
      }

      // Remove entities that are no longer in the snapshot
      this.entityRenderer.removeStaleEntities(to.entities.map((e) => e.id))
    }

    // === Step 4: Update camera ===
    this.camera.update(deltaMs)

    // === Step 5: Render particles and effects ===
    this.particleManager.update(deltaMs)

    // === Step 6: Update UI overlays ===
    this.uiManager.update({
      gameTimeMs: renderTimeMs,
      localPlayer: this.entityRenderer.getLocalPlayer(),
      deltaMs,
    })

    // PixiJS renders the scene graph automatically after this callback.
  }

  /**
   * Called when a new snapshot arrives from the server.
   */
  onSnapshotReceived(snapshot: { tick: number; gameTimeMs: number }): void {
    this.latestServerTimeMs = snapshot.gameTimeMs
    // serverTimeOffsetMs could be used for clock sync (see Section 7)
  }
}
```

### 3.4 Input Handling

The `InputManager` translates raw DOM events into game commands:

```typescript
// apps/web/src/game/input/input-manager.ts

import { PlayerInput } from '@league/shared'

interface RawInput {
  type: 'rightclick' | 'keydown' | 'keyup'
  worldX?: number
  worldY?: number
  key?: string
  targetEntityId?: string
}

export class InputManager {
  private pendingInputs: PlayerInput[] = []
  private sequenceId = 0
  private keysDown = new Set<string>()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly screenToWorld: (sx: number, sy: number) => { x: number; y: number },
  ) {
    this.bindEvents()
  }

  private bindEvents(): void {
    // Right-click: move or attack-move
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const world = this.screenToWorld(e.clientX, e.clientY)
      // Check if clicking on an enemy entity for attack command
      // (entity picking is handled by the renderer)
      this.enqueue({
        type: 'move',
        payload: { targetX: world.x, targetY: world.y },
      })
    })

    // Keyboard for abilities (Q, W, E, R) and stop (S)
    document.addEventListener('keydown', (e) => {
      if (this.keysDown.has(e.key)) return // ignore held keys
      this.keysDown.add(e.key)

      const abilityKeys: Record<string, number> = {
        q: 0,
        w: 1,
        e: 2,
        r: 3,
      }

      if (e.key.toLowerCase() in abilityKeys) {
        this.enqueue({
          type: 'cast_ability',
          payload: { abilityIndex: abilityKeys[e.key.toLowerCase()] },
        })
      }

      if (e.key.toLowerCase() === 's') {
        this.enqueue({ type: 'stop', payload: {} })
      }
    })

    document.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.key)
    })
  }

  private enqueue(partial: Pick<PlayerInput, 'type' | 'payload'>): void {
    this.pendingInputs.push({
      ...partial,
      clientTick: 0, // filled by network layer with latest known server tick
      sequenceId: ++this.sequenceId,
    })
  }

  poll(): PlayerInput[] {
    const inputs = this.pendingInputs
    this.pendingInputs = []
    return inputs
  }

  destroy(): void {
    // Remove event listeners (simplified — use AbortController in production)
    this.keysDown.clear()
    this.pendingInputs = []
  }
}
```

---

## 4. Entity State Machine

### 4.1 State Definitions

Every game entity (champion, minion, turret) operates as a finite state machine. The current state determines which actions the entity can perform and how it is rendered.

| State               | Description                                        | Allowed Actions                                                     |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| **Idle**            | Standing still, not acting                         | Move, Attack, Cast, Use Item                                        |
| **Moving**          | Traveling along a path                             | Attack (cancels move), Cast (some spells), Stop                     |
| **Attacking**       | Auto-attack sequence (windup, damage, recovery)    | Move (during recovery, enables orb-walking), Cast (during recovery) |
| **Casting**         | Executing an ability (cast time, effect, recovery) | Move (during recovery, for some spells), Stop (if not committed)    |
| **Channeling**      | Sustaining a channel spell over time               | Stop (cancels channel), nothing else                                |
| **CrowdControlled** | Affected by hard CC (stun, knockup, root)          | None (root allows casting/attacking in place)                       |
| **Dead**            | HP reached 0, waiting to respawn                   | None                                                                |
| **Respawning**      | Transitioning back to life in base                 | None (brief invulnerability)                                        |

### 4.2 State Transition Diagram

```
                                ┌──────────────────────────────────────────┐
                                │           CROWD CONTROLLED               │
                                │  (stun, knockup, suppress)               │
                                │                                          │
                                │  - Cannot act                            │
                                │  - CC duration timer ticking             │
                                └──────────┬───────────────────────────────┘
                                           │ CC expires
                                           ▼
                           ┌───────────────────────────────┐
              move cmd     │                               │   attack cmd
         ┌────────────────►│            IDLE               │◄──────────────┐
         │                 │                               │               │
         │                 │  - Standing still              │               │
         │                 │  - Can act freely              │               │
         │                 └───┬────────┬──────────┬───────┘               │
         │                     │        │          │                       │
         │           move cmd  │  attack │  cast   │                      │
         │                     │   cmd   │  cmd    │                      │
         │                     ▼        ▼          ▼                      │
         │              ┌──────────┐ ┌──────────┐ ┌──────────┐           │
         │              │          │ │          │ │          │           │
         │              │ MOVING   │ │ATTACKING │ │ CASTING  │           │
         │              │          │ │          │ │          │           │
    ┌────┤              │ - Path-  │ │ - Windup │ │ - Cast   │           │
    │    │              │   finding│ │ - Damage │ │   time   │           │
    │    │              │ - Can be │ │ - Recov- │ │ - Effect │           │
    │    │              │   inter- │ │   ery    │ │ - Recov- │           │
    │    │              │   rupted │ │          │ │   ery    │           │
    │    │              └──┬───────┘ └────┬─────┘ └──┬──────┘           │
    │    │                 │              │           │                   │
    │    │     arrived /   │   recovery   │  recovery │                  │
    │    │     stop cmd    │   complete   │  complete │                  │
    │    │                 │              │           │                   │
    │    └─────────────────┘──────────────┘───────────┘                  │
    │                              │                                      │
    │                              │ HP <= 0 (from ANY state)            │
    │                              ▼                                      │
    │                     ┌──────────────────┐                           │
    │                     │                  │                           │
    │                     │      DEAD        │                           │
    │                     │                  │                           │
    │                     │  - Respawn timer │                           │
    │                     │  - No actions    │                           │
    │                     └────────┬─────────┘                           │
    │                              │ respawn timer expires               │
    │                              ▼                                      │
    │                     ┌──────────────────┐                           │
    │                     │                  │                           │
    │                     │   RESPAWNING     │───── brief delay ────────┘
    │                     │                  │       → transitions
    │                     │  - Teleport to   │         to IDLE
    │                     │    base          │
    │                     │  - Brief invuln  │
    │                     └──────────────────┘
    │
    │  ┌──────────────────────────────────────┐
    └──│          CHANNELING                   │
       │                                       │
       │  - Cannot move or act                 │
       │  - Interrupted by CC, move, stop      │
       │  - Effect fires on completion          │
       │                                       │
       └──────────┬────────────────────────────┘
                  │ channel completes / interrupted
                  └──→ IDLE
```

### 4.3 State Capability Matrix

This table defines exactly what is permitted in each state. The server enforces these rules; the client uses them for visual feedback (e.g., greying out buttons).

| Capability       | Idle | Moving | Attacking (windup) | Attacking (recovery) | Casting | Channeling | CC (stun) | CC (root) | Dead |
| ---------------- | :--: | :----: | :----------------: | :------------------: | :-----: | :--------: | :-------: | :-------: | :--: |
| Issue Move       | YES  |  YES   |       Cancel       |         YES          |   No    |   Cancel   |    No     |    No     |  No  |
| Issue Attack     | YES  |  YES   |         No         |         YES          |   No    |   Cancel   |    No     |    YES    |  No  |
| Cast Ability     | YES  |  YES   |       Cancel       |         YES          |   No    |   Cancel   |    No     |    YES    |  No  |
| Use Item         | YES  |  YES   |         No         |         YES          |   No    |     No     |    No     |    No     |  No  |
| Is Targetable    | YES  |  YES   |        YES         |         YES          |   YES   |    YES     |    YES    |    YES    |  No  |
| Can be Displaced | YES  |  YES   |        YES         |         YES          |   YES   |    Some    |    YES    |    No     |  No  |

> **Cancel** means the current action is aborted and the new command takes effect. During **windup**, cancelling an auto-attack means no damage is dealt (this is the basis of animation cancelling / orb-walking).

### 4.4 StateMachine Implementation

```typescript
// apps/api/src/modules/game/ecs/state-machine.ts

export type EntityStateType =
  | 'idle'
  | 'moving'
  | 'attacking'
  | 'casting'
  | 'channeling'
  | 'crowd_controlled'
  | 'dead'
  | 'respawning'

export interface StateContext {
  entityId: string
  gameTimeMs: number
  tickNumber: number
}

export interface EntityState {
  readonly type: EntityStateType

  /**
   * Called when this state becomes the active state.
   */
  onEnter(ctx: StateContext): void

  /**
   * Called every tick while this state is active.
   * Returns the next state type if a transition should occur, or null to remain.
   */
  onTick(ctx: StateContext, deltaMs: number): EntityStateType | null

  /**
   * Called when this state is being exited.
   */
  onExit(ctx: StateContext): void

  /**
   * Whether a given action is allowed in this state.
   */
  canPerform(action: 'move' | 'attack' | 'cast' | 'item' | 'channel'): boolean
}

export class StateMachine {
  private states = new Map<EntityStateType, EntityState>()
  private currentState: EntityState | null = null
  private _currentType: EntityStateType = 'idle'

  get currentType(): EntityStateType {
    return this._currentType
  }

  registerState(state: EntityState): void {
    this.states.set(state.type, state)
  }

  /**
   * Force a transition to a new state. Used for external triggers
   * like receiving crowd control or dying.
   */
  transitionTo(type: EntityStateType, ctx: StateContext): void {
    if (this.currentState) {
      this.currentState.onExit(ctx)
    }

    const nextState = this.states.get(type)
    if (!nextState) {
      throw new Error(`Unknown state: ${type}`)
    }

    this.currentState = nextState
    this._currentType = type
    this.currentState.onEnter(ctx)
  }

  /**
   * Tick the current state. If it returns a new state type,
   * perform the transition automatically.
   */
  tick(ctx: StateContext, deltaMs: number): void {
    if (!this.currentState) return

    const nextType = this.currentState.onTick(ctx, deltaMs)
    if (nextType !== null && nextType !== this._currentType) {
      this.transitionTo(nextType, ctx)
    }
  }

  canPerform(action: 'move' | 'attack' | 'cast' | 'item' | 'channel'): boolean {
    return this.currentState?.canPerform(action) ?? false
  }
}
```

#### Example State: Attacking

```typescript
// apps/api/src/modules/game/ecs/states/attacking.state.ts

import { EntityState, EntityStateType, StateContext } from '../state-machine'

export enum AttackPhase {
  Windup, // can be cancelled (animation cancel / orb-walk)
  DamagePoint, // committed — damage will be dealt
  Recovery, // can be cancelled to issue new commands early
}

export class AttackingState implements EntityState {
  readonly type: EntityStateType = 'attacking'

  phase = AttackPhase.Windup

  // Timers in milliseconds
  private windupTimerMs = 0
  private damagePointTimerMs = 0
  private recoveryTimerMs = 0

  // Set by the entity when entering this state
  windupDurationMs = 0
  damagePointDurationMs = 0
  recoveryDurationMs = 0
  targetEntityId: string | null = null

  // Callback to apply damage when the damage point fires
  onDamagePoint: ((ctx: StateContext) => void) | null = null

  onEnter(_ctx: StateContext): void {
    this.phase = AttackPhase.Windup
    this.windupTimerMs = 0
    this.damagePointTimerMs = 0
    this.recoveryTimerMs = 0
  }

  onTick(_ctx: StateContext, deltaMs: number): EntityStateType | null {
    switch (this.phase) {
      case AttackPhase.Windup:
        this.windupTimerMs += deltaMs
        if (this.windupTimerMs >= this.windupDurationMs) {
          this.phase = AttackPhase.DamagePoint
        }
        break

      case AttackPhase.DamagePoint:
        // Damage is dealt on the first tick of this phase
        if (this.damagePointTimerMs === 0 && this.onDamagePoint) {
          this.onDamagePoint(_ctx)
        }
        this.damagePointTimerMs += deltaMs
        if (this.damagePointTimerMs >= this.damagePointDurationMs) {
          this.phase = AttackPhase.Recovery
        }
        break

      case AttackPhase.Recovery:
        this.recoveryTimerMs += deltaMs
        if (this.recoveryTimerMs >= this.recoveryDurationMs) {
          return 'idle' // attack complete
        }
        break
    }

    return null // stay in attacking state
  }

  onExit(_ctx: StateContext): void {
    this.targetEntityId = null
    this.onDamagePoint = null
  }

  canPerform(action: 'move' | 'attack' | 'cast' | 'item' | 'channel'): boolean {
    // During windup: can cancel with move or cast (animation cancel)
    if (this.phase === AttackPhase.Windup) {
      return action === 'move' || action === 'cast'
    }
    // During damage point: committed, cannot do anything
    if (this.phase === AttackPhase.DamagePoint) {
      return false
    }
    // During recovery: can cancel with anything (orb-walking)
    if (this.phase === AttackPhase.Recovery) {
      return action === 'move' || action === 'attack' || action === 'cast' || action === 'item'
    }
    return false
  }
}
```

---

## 5. Animation Timing

### 5.1 Auto-Attack Timing

An auto-attack is divided into three precise phases. The timing of each phase is derived from the champion's current attack speed.

```
Auto-Attack Timeline:

  ┌───── windup ─────┐┌── damage point ──┐┌────── recovery ──────┐
  │                   ││                  ││                      │
  │  Arm pulls back   ││  Projectile      ││  Arm returns to     │
  │  (cancellable)    ││  launches / hit  ││  idle (cancellable)  │
  │                   ││  (committed)     ││                      │
  ├───────────────────┤├──────────────────┤├──────────────────────┤
  t=0            t=windup         t=windup+dp         t=totalAttackTime

  Total attack time = 1 / attackSpeed
  Example: 0.625 AS → 1600ms total

  If cancelled during windup:  NO damage, entity returns to idle/moving
  If cancelled during recovery: damage already dealt, free to move/attack
     ↑ This is "orb-walking" or "kiting"
```

### 5.2 Attack Speed and Windup Formula

```typescript
// packages/shared/src/formulas/attack-timing.ts

export interface AttackTimings {
  totalMs: number // full attack cycle duration
  windupMs: number // cancellable windup
  damagePointMs: number // committed damage phase (very short)
  recoveryMs: number // cancellable recovery
}

/**
 * Calculates auto-attack phase durations based on current attack speed.
 *
 * @param attackSpeed - Current attacks per second (e.g. 0.625)
 * @param baseWindupPercent - Champion-specific windup as percent of total (e.g. 0.3 = 30%)
 *                           This is a fixed ratio defined per champion.
 * @returns Timing for each phase in milliseconds
 */
export function calculateAttackTimings(
  attackSpeed: number,
  baseWindupPercent: number,
): AttackTimings {
  // Total cycle time for one auto-attack
  const totalMs = 1000 / attackSpeed

  // Windup scales inversely with attack speed — faster AS = shorter windup
  // The windup percent stays constant, but the absolute time shrinks.
  const windupMs = totalMs * baseWindupPercent

  // Damage point is very brief — just the frame damage is applied
  // Fixed at a small percentage of total attack time.
  const damagePointMs = totalMs * 0.05

  // Recovery fills the rest of the cycle
  const recoveryMs = totalMs - windupMs - damagePointMs

  return { totalMs, windupMs, damagePointMs, recoveryMs }
}

// Example calculations:
//
// Base AS 0.625, windup 30%:
//   total = 1600ms, windup = 480ms, damage = 80ms, recovery = 1040ms
//
// With items, AS = 1.2, windup 30%:
//   total = 833ms, windup = 250ms, damage = 42ms, recovery = 542ms
//
// With items, AS = 2.5 (very fast), windup 30%:
//   total = 400ms, windup = 120ms, damage = 20ms, recovery = 260ms
```

### 5.3 Spell Cast Timing

Spells follow a similar structure, but with different phases:

```
Standard Cast:
  ┌──── cast time ────┐┌── effect ──┐┌── recovery ──┐
  │                    ││            ││              │
  │  Champion plays    ││ Damage /   ││ Return to    │
  │  cast animation    ││ CC / heal  ││ idle         │
  │  (committed)       ││ applied    ││ (cancellable)│
  └────────────────────┘└────────────┘└──────────────┘

Instant Cast (e.g., a dash or a self-buff):
  ┌─ effect ─┐
  │           │
  │ Immediate │  No cast time, no recovery
  │ effect    │
  └───────────┘

Channel Spell:
  ┌─ cast ─┐┌──────── channel duration ────────┐┌── effect ──┐
  │        ││                                   ││            │
  │ Brief  ││  Tick-based effects over time     ││ Final      │
  │ start  ││  (interruptible by CC/movement)   ││ burst      │
  └────────┘└───────────────────────────────────┘└────────────┘
```

### 5.4 Spell Timing Implementation

```typescript
// packages/shared/src/types/ability.ts

export type AbilityCastType = 'standard' | 'instant' | 'channel'

export interface AbilityTiming {
  castType: AbilityCastType
  castTimeMs: number // 0 for instant casts
  channelDurationMs: number // 0 for non-channels
  recoveryMs: number // post-effect recovery
}

export interface AbilityDefinition {
  id: string
  name: string
  maxRank: number
  timing: AbilityTiming
  cooldownByRank: number[] // cooldown in seconds per rank
  manaCostByRank: number[] // mana cost per rank
  baseDamageByRank: number[] // base damage per rank
  adRatio: number // scaling with AD
  apRatio: number // scaling with AP
  range: number // cast range in game units
}
```

```typescript
// apps/api/src/modules/game/ecs/states/casting.state.ts

import { EntityState, EntityStateType, StateContext } from '../state-machine'
import { AbilityTiming } from '@league/shared'

export enum CastPhase {
  CastTime,
  Effect,
  Recovery,
}

export class CastingState implements EntityState {
  readonly type: EntityStateType = 'casting'

  phase = CastPhase.CastTime
  private phaseTimerMs = 0

  timing: AbilityTiming = {
    castType: 'standard',
    castTimeMs: 0,
    channelDurationMs: 0,
    recoveryMs: 0,
  }

  onEffect: ((ctx: StateContext) => void) | null = null

  onEnter(_ctx: StateContext): void {
    this.phase = CastPhase.CastTime
    this.phaseTimerMs = 0

    // Instant casts skip directly to effect
    if (this.timing.castTimeMs <= 0) {
      this.phase = CastPhase.Effect
    }
  }

  onTick(ctx: StateContext, deltaMs: number): EntityStateType | null {
    this.phaseTimerMs += deltaMs

    switch (this.phase) {
      case CastPhase.CastTime:
        if (this.phaseTimerMs >= this.timing.castTimeMs) {
          this.phase = CastPhase.Effect
          this.phaseTimerMs = 0
        }
        break

      case CastPhase.Effect:
        // Fire effect on first tick of this phase
        if (this.phaseTimerMs <= deltaMs && this.onEffect) {
          this.onEffect(ctx)
        }
        this.phase = CastPhase.Recovery
        this.phaseTimerMs = 0
        break

      case CastPhase.Recovery:
        if (this.phaseTimerMs >= this.timing.recoveryMs) {
          return 'idle'
        }
        break
    }

    return null
  }

  onExit(_ctx: StateContext): void {
    this.onEffect = null
  }

  canPerform(action: 'move' | 'attack' | 'cast' | 'item' | 'channel'): boolean {
    // During recovery, the caster can begin moving or acting
    if (this.phase === CastPhase.Recovery) {
      return action === 'move' || action === 'attack' || action === 'cast'
    }
    return false
  }
}
```

```typescript
// apps/api/src/modules/game/ecs/states/channeling.state.ts

import { EntityState, EntityStateType, StateContext } from '../state-machine'

export class ChannelingState implements EntityState {
  readonly type: EntityStateType = 'channeling'

  private timerMs = 0
  channelDurationMs = 0
  interrupted = false

  /** Called each tick during the channel. Use for per-tick effects. */
  onChannelTick: ((ctx: StateContext, progressPercent: number) => void) | null = null
  /** Called when channel completes naturally. */
  onChannelComplete: ((ctx: StateContext) => void) | null = null
  /** Called when channel is interrupted. */
  onChannelInterrupted: ((ctx: StateContext) => void) | null = null

  onEnter(_ctx: StateContext): void {
    this.timerMs = 0
    this.interrupted = false
  }

  onTick(ctx: StateContext, deltaMs: number): EntityStateType | null {
    if (this.interrupted) {
      this.onChannelInterrupted?.(ctx)
      return 'idle'
    }

    this.timerMs += deltaMs
    const progress = Math.min(this.timerMs / this.channelDurationMs, 1)

    this.onChannelTick?.(ctx, progress)

    if (this.timerMs >= this.channelDurationMs) {
      this.onChannelComplete?.(ctx)
      return 'idle'
    }

    return null
  }

  onExit(_ctx: StateContext): void {
    this.onChannelTick = null
    this.onChannelComplete = null
    this.onChannelInterrupted = null
  }

  canPerform(_action: 'move' | 'attack' | 'cast' | 'item' | 'channel'): boolean {
    // Nothing is allowed during channeling.
    // External interrupts (CC, move command) force-transition out.
    return false
  }
}
```

---

## 6. Turn Order / Priority

### 6.1 Why Order Matters

Within a single tick, all game systems run sequentially in a fixed order. This ordering is critical for correctness:

```
Example: Two champions auto-attack each other on the same tick.
Both are at 50 HP. Both deal 60 damage.

WRONG approach (process one champion fully, then the other):
  Champion A attacks → B takes 60 damage → B dies → B never attacks back
  Result: Only A kills B. Order-dependent. Unfair.

CORRECT approach (separate damage application from death checks):
  Phase 6 (Collisions/Damage): A deals 60 to B, B deals 60 to A
  Phase 9 (Death Check):        B has -10 HP → dies. A has -10 HP → dies.
  Result: Both kill each other. Simultaneous. Fair.
```

### 6.2 Complete Tick Phase Ordering

The order defined in Section 2.2 is intentional. Here is the rationale for each ordering decision:

```
Phase 1-2: INPUTS FIRST
├── Player actions feel responsive: at most 33ms between input and processing
├── Input validation uses current state (before anything moves this tick)
└── Commands from this tick take effect starting with movement this tick

Phase 3: MOVEMENT BEFORE COLLISION
├── Positions are up-to-date before we check if projectiles hit
├── A champion who dashes away this tick dodges a projectile that would
│   have hit at the old position
└── Movement uses the PREVIOUS tick's collision data (intentional: allows
    entities to "commit" to movement before being interrupted)

Phase 4: ABILITIES/COOLDOWNS BEFORE PROJECTILES
├── New abilities can spawn projectiles this tick
├── Cooldowns tick down so abilities are available at the right time
├── Buffs/debuffs are updated before stat-dependent calculations
└── Buff expiry happens before damage calculations (e.g., a shield that
    expires this tick does NOT absorb damage this tick)

Phase 5-6: PROJECTILES, THEN COLLISIONS
├── Projectiles move to their new positions
├── Collision detection checks projectile-entity overlaps
├── All damage from collisions is QUEUED, not immediately applied
└── Damage queue is flushed at the end of Phase 6 (all at once)

Phase 7-8: AI AFTER DAMAGE
├── Minion/turret AI sees the latest state (including damage this tick)
├── Turrets can retarget if their target just died
├── Minions acquire new targets if their target is no longer valid
└── AI-issued attacks go into next tick's action queue (not processed
    until next tick Phase 2)

Phase 9: DEATH CHECK LAST (before snapshot)
├── All damage from all sources this tick has been applied
├── Simultaneous kills are correctly resolved
├── Respawn timers start based on current game time
└── Entities are marked dead AFTER all damage, so assists are correctly
    tracked within the same tick

Phase 10-11: SNAPSHOT AND BROADCAST
├── Snapshot captures the fully-resolved state of this tick
├── All clients receive the same snapshot (per-player fog of war filtering)
└── Tick number and game time are embedded for client synchronization
```

### 6.3 Damage Queue

To enable simultaneous kills and correct multi-source damage, damage is queued during Phases 5-6 and applied in bulk:

```typescript
// apps/api/src/modules/game/combat/damage-queue.ts

export interface DamageEntry {
  sourceEntityId: string
  targetEntityId: string
  amount: number
  type: 'physical' | 'magical' | 'true'
  sourceAbilityId?: string // for assist tracking
  tick: number
}

export class DamageQueue {
  private queue: DamageEntry[] = []

  enqueue(entry: DamageEntry): void {
    this.queue.push(entry)
  }

  /**
   * Apply all queued damage. Called once per tick after all
   * damage sources have been evaluated.
   *
   * Returns a list of entities whose HP changed this tick,
   * used by the death check phase.
   */
  flush(
    getEntity: (id: string) => { hp: number; armor: number; magicResist: number },
    applyDamage: (targetId: string, finalDamage: number, sourceId: string) => void,
  ): string[] {
    const affectedEntities = new Set<string>()

    for (const entry of this.queue) {
      const target = getEntity(entry.targetEntityId)
      if (!target) continue

      let finalDamage: number

      switch (entry.type) {
        case 'physical':
          finalDamage = entry.amount * (100 / (100 + target.armor))
          break
        case 'magical':
          finalDamage = entry.amount * (100 / (100 + target.magicResist))
          break
        case 'true':
          finalDamage = entry.amount
          break
      }

      applyDamage(entry.targetEntityId, finalDamage, entry.sourceEntityId)
      affectedEntities.add(entry.targetEntityId)
    }

    this.queue = []
    return [...affectedEntities]
  }
}
```

### 6.4 Buff/Debuff Processing Order

Buffs and debuffs are processed in a specific order within Phase 4 to avoid stat dependency issues:

```
Buff Processing Order (within Phase 4):
  1. Tick buff durations (remove expired buffs)
  2. Apply buff effects in this order:
     a. Flat stat modifiers      (+50 AD from item)
     b. Percent stat modifiers   (+30% attack speed)
     c. Crowd control effects    (stun, slow, root)
     d. Damage-over-time ticks   (poison, ignite)
     e. Heal-over-time ticks     (regeneration)
  3. Recalculate final stats     (base + flat bonuses) * percent bonuses
```

This ordering ensures that:

- A percent bonus always applies to the correct flat total (not stale data).
- CC is applied before DoT (so a cleansed CC does not prevent DoT on the same tick).
- Stats are finalized before the damage phases use them.

---

## 7. Game Clock

### 7.1 Server Game Clock

The server maintains a game clock that starts at `0` when the match enters the `InProgress` state and increments by exactly `TICK_DURATION_MS` every tick. This clock is the single source of truth for all time-based game events.

```typescript
// apps/api/src/modules/game/core/game-clock.ts

import { TICK_DURATION_MS } from '@league/shared'

export class GameClock {
  private _elapsedMs = 0
  private _paused = false

  /**
   * Called once per tick. Advances the clock by exactly one tick duration.
   * This ensures the game clock is deterministic and independent of
   * real-world timing jitter.
   */
  tick(): void {
    if (!this._paused) {
      this._elapsedMs += TICK_DURATION_MS
    }
  }

  get elapsedMs(): number {
    return this._elapsedMs
  }

  get elapsedSeconds(): number {
    return this._elapsedMs / 1000
  }

  /**
   * Returns game time as "M:SS" format for display and logging.
   */
  get formatted(): string {
    const totalSeconds = Math.floor(this._elapsedMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  pause(): void {
    this._paused = true
  }

  resume(): void {
    this._paused = false
  }

  get isPaused(): boolean {
    return this._paused
  }
}
```

### 7.2 Timed Game Events

The game clock drives all scheduled events. These are checked during the tick cycle:

```typescript
// apps/api/src/modules/game/core/game-event-scheduler.ts

import { GameClock } from './game-clock'

interface ScheduledEvent {
  id: string
  triggerAtMs: number
  repeatIntervalMs?: number // if set, event repeats at this interval
  callback: () => void
  fired: boolean
}

export class GameEventScheduler {
  private events: ScheduledEvent[] = []

  /**
   * Register ARAM-specific timed events.
   */
  registerDefaultEvents(spawnMinionWave: () => void): void {
    // First minion wave spawns at 1:00
    this.schedule({
      id: 'first_minion_wave',
      triggerAtMs: 60_000,
      callback: spawnMinionWave,
    })

    // Subsequent waves every 30 seconds after the first
    this.schedule({
      id: 'minion_wave_loop',
      triggerAtMs: 90_000, // 1:30
      repeatIntervalMs: 30_000, // every 30s
      callback: spawnMinionWave,
    })
  }

  schedule(event: Omit<ScheduledEvent, 'fired'>): void {
    this.events.push({ ...event, fired: false })
  }

  /**
   * Called once per tick. Fires any events whose trigger time has been reached.
   */
  tick(clock: GameClock): void {
    const now = clock.elapsedMs

    for (const event of this.events) {
      if (event.fired && !event.repeatIntervalMs) continue

      if (now >= event.triggerAtMs) {
        event.callback()
        event.fired = true

        // If repeating, schedule the next occurrence
        if (event.repeatIntervalMs) {
          event.triggerAtMs += event.repeatIntervalMs
          event.fired = false
        }
      }
    }
  }
}
```

### 7.3 Respawn Timers

Champion respawn timers are derived from game time and champion level, as defined in the game design doc:

```typescript
// packages/shared/src/formulas/respawn.ts

/**
 * Calculates respawn time for a champion in ARAM mode.
 * Formula: 10 + (level * 2) seconds
 *
 * Examples:
 *   Level 1  → 12 seconds
 *   Level 6  → 22 seconds
 *   Level 11 → 32 seconds
 *   Level 18 → 46 seconds
 */
export function calculateRespawnTimeMs(championLevel: number): number {
  const seconds = 10 + championLevel * 2
  return seconds * 1000
}
```

### 7.4 Client Clock Synchronization

The client maintains its own estimate of the server's game time. It synchronizes using the `gameTimeMs` field embedded in every snapshot:

```typescript
// apps/web/src/game/network/clock-sync.ts

import { TICK_DURATION_MS } from '@league/shared'

export class ClockSync {
  private serverGameTimeMs = 0
  private localTimestampAtSync = 0
  private _offsetMs = 0

  /**
   * Called when a snapshot is received.
   * Updates the client's understanding of server time.
   */
  onSnapshot(serverGameTimeMs: number): void {
    const now = performance.now()

    // On first snapshot, just set the baseline
    if (this.serverGameTimeMs === 0) {
      this.serverGameTimeMs = serverGameTimeMs
      this.localTimestampAtSync = now
      return
    }

    // Calculate expected server time based on our local clock
    const localElapsed = now - this.localTimestampAtSync
    const expectedServerTime = this.serverGameTimeMs + localElapsed

    // The difference between expected and actual is our drift
    const drift = serverGameTimeMs - expectedServerTime

    // Smooth correction: blend toward the server's time gradually
    // to avoid visible jitter. Apply 10% of the correction per snapshot.
    this._offsetMs += drift * 0.1

    // Update baseline
    this.serverGameTimeMs = serverGameTimeMs
    this.localTimestampAtSync = now
  }

  /**
   * Returns the estimated server game time at this instant.
   * Used by the render loop to determine interpolation time.
   */
  getEstimatedServerTimeMs(): number {
    const localElapsed = performance.now() - this.localTimestampAtSync
    return this.serverGameTimeMs + localElapsed + this._offsetMs
  }

  /**
   * Returns the time the client should render at (one tick behind server).
   */
  getRenderTimeMs(): number {
    return this.getEstimatedServerTimeMs() - TICK_DURATION_MS
  }

  /**
   * Formatted game time for UI display (e.g., "3:45").
   */
  getFormattedGameTime(): string {
    const totalSeconds = Math.floor(this.getEstimatedServerTimeMs() / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }
}
```

---

## 8. Match Lifecycle

### 8.1 Match States

A match progresses through five distinct states. The transition is linear and irreversible (no going backwards).

```
┌──────────┐     all players     ┌───────────┐     countdown     ┌────────────┐
│          │     connected       │           │     complete      │            │
│ Loading  │────────────────────►│ Countdown │──────────────────►│ InProgress │
│          │                     │  (3-2-1)  │                   │            │
└──────────┘                     └───────────┘                   └─────┬──────┘
     │                                                                 │
     │ timeout / player                                     nexus destroyed
     │ disconnect                                                      │
     │                                                                 ▼
     │                                                          ┌──────────┐
     │                                                          │          │
     └──────────────────────────────────────────────────────────►│  Ended   │
                                                                │          │
                                                                └────┬─────┘
                                                                     │
                                                              results shown
                                                              stats saved
                                                                     │
                                                                     ▼
                                                                ┌──────────┐
                                                                │          │
                                                                │ Cleanup  │
                                                                │          │
                                                                └──────────┘
```

### 8.2 State Descriptions

| State          | Duration                                       | Game Loop Active? | What Happens                                                                                                                                                    |
| -------------- | ---------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Loading**    | Until all 10 players connect (max 60s timeout) | No                | Server creates the match instance, initializes the map, spawns structures. Each client loads assets and signals readiness. A progress bar shows loading status. |
| **Countdown**  | 3 seconds                                      | No (clock paused) | All players see a "3... 2... 1..." overlay. Champions are spawned in their bases but cannot move or act. The camera centers on the player's champion.           |
| **InProgress** | Until win condition                            | Yes (30 Hz)       | The main game. Game clock starts at 0:00 and counts up. Minions spawn at 1:00. All systems active.                                                              |
| **Ended**      | 10 seconds                                     | No (loop stops)   | A nexus has been destroyed. Victory/defeat screen shown. Players cannot act. Kill stats, damage dealt, gold earned are displayed.                               |
| **Cleanup**    | Instant                                        | No                | Server saves match results to the database. WebSocket connections are closed. Game state is garbage collected. Players are returned to the lobby.               |

### 8.3 Implementation

```typescript
// apps/api/src/modules/game/core/match-lifecycle.ts

import { Logger } from '@nestjs/common'
import { GameLoop } from './game-loop'
import { GameState } from './game-state'
import { GameClock } from './game-clock'
import { BroadcastService } from '../network/broadcast.service'

export type MatchPhase = 'loading' | 'countdown' | 'in_progress' | 'ended' | 'cleanup'

export class MatchLifecycle {
  private readonly logger = new Logger(MatchLifecycle.name)

  private _phase: MatchPhase = 'loading'
  private connectedPlayerIds = new Set<string>()
  private countdownTimerMs = 0
  private endedTimerMs = 0

  private static readonly COUNTDOWN_DURATION_MS = 3000
  private static readonly LOADING_TIMEOUT_MS = 60_000
  private static readonly END_SCREEN_DURATION_MS = 10_000

  constructor(
    private readonly matchId: string,
    private readonly expectedPlayerIds: string[],
    private readonly gameLoop: GameLoop,
    private readonly gameState: GameState,
    private readonly gameClock: GameClock,
    private readonly broadcastService: BroadcastService,
    private readonly onMatchComplete: (matchId: string, results: MatchResults) => void,
  ) {}

  get phase(): MatchPhase {
    return this._phase
  }

  // --- Loading Phase ---

  onPlayerConnected(playerId: string): void {
    if (this._phase !== 'loading') return

    this.connectedPlayerIds.add(playerId)
    this.logger.log(
      `Player ${playerId} connected (${this.connectedPlayerIds.size}/${this.expectedPlayerIds.length})`,
    )

    this.broadcastService.sendLoadingProgress({
      connected: this.connectedPlayerIds.size,
      total: this.expectedPlayerIds.length,
    })

    if (this.connectedPlayerIds.size === this.expectedPlayerIds.length) {
      this.transitionToCountdown()
    }
  }

  onLoadingTimeout(): void {
    if (this._phase !== 'loading') return

    this.logger.warn(
      `Match ${this.matchId}: loading timed out. ` +
        `${this.connectedPlayerIds.size}/${this.expectedPlayerIds.length} connected.`,
    )

    // Abort match if not enough players
    this.transitionToEnded('aborted')
  }

  // --- Countdown Phase ---

  private transitionToCountdown(): void {
    this._phase = 'countdown'
    this.countdownTimerMs = 0
    this.gameClock.pause()

    // Spawn champions in their bases (but they cannot move)
    this.gameState.spawnChampions()

    this.broadcastService.sendMatchPhase('countdown', {
      durationMs: MatchLifecycle.COUNTDOWN_DURATION_MS,
    })

    this.logger.log(`Match ${this.matchId}: countdown started`)

    // Run a simple interval for the countdown (not the game loop)
    const countdownInterval = setInterval(() => {
      this.countdownTimerMs += 1000

      this.broadcastService.sendCountdownTick(
        Math.ceil((MatchLifecycle.COUNTDOWN_DURATION_MS - this.countdownTimerMs) / 1000),
      )

      if (this.countdownTimerMs >= MatchLifecycle.COUNTDOWN_DURATION_MS) {
        clearInterval(countdownInterval)
        this.transitionToInProgress()
      }
    }, 1000)
  }

  // --- InProgress Phase ---

  private transitionToInProgress(): void {
    this._phase = 'in_progress'
    this.gameClock.resume()

    this.broadcastService.sendMatchPhase('in_progress', {})

    // Start the authoritative game loop
    this.gameLoop.start()

    this.logger.log(`Match ${this.matchId}: game started`)
  }

  /**
   * Called by the game state when a nexus is destroyed.
   */
  onNexusDestroyed(winningTeam: 'blue' | 'red'): void {
    if (this._phase !== 'in_progress') return
    this.transitionToEnded(winningTeam)
  }

  // --- Ended Phase ---

  private transitionToEnded(result: 'blue' | 'red' | 'aborted'): void {
    this._phase = 'ended'

    // Stop the game loop
    this.gameLoop.stop()

    const results = this.gameState.compileResults(result)

    this.broadcastService.sendMatchPhase('ended', {
      winner: result,
      results,
      durationMs: MatchLifecycle.END_SCREEN_DURATION_MS,
    })

    this.logger.log(
      `Match ${this.matchId}: ended. Winner: ${result}. ` + `Duration: ${this.gameClock.formatted}`,
    )

    // After the end screen duration, clean up
    setTimeout(() => {
      this.transitionToCleanup(results)
    }, MatchLifecycle.END_SCREEN_DURATION_MS)
  }

  // --- Cleanup Phase ---

  private transitionToCleanup(results: MatchResults): void {
    this._phase = 'cleanup'

    this.broadcastService.sendMatchPhase('cleanup', {})
    this.broadcastService.disconnectAll()

    // Persist match results and free resources
    this.onMatchComplete(this.matchId, results)

    this.logger.log(`Match ${this.matchId}: cleanup complete`)
  }

  // --- Player Disconnect Handling ---

  onPlayerDisconnected(playerId: string): void {
    this.connectedPlayerIds.delete(playerId)

    if (this._phase === 'loading') {
      this.broadcastService.sendLoadingProgress({
        connected: this.connectedPlayerIds.size,
        total: this.expectedPlayerIds.length,
      })
    }

    if (this._phase === 'in_progress' && this.connectedPlayerIds.size === 0) {
      this.logger.warn(`Match ${this.matchId}: all players disconnected, ending match`)
      this.transitionToEnded('aborted')
    }
  }
}

// --- Types ---

export interface MatchResults {
  winner: 'blue' | 'red' | 'aborted'
  durationMs: number
  players: PlayerMatchResult[]
}

export interface PlayerMatchResult {
  playerId: string
  championId: string
  team: 'blue' | 'red'
  kills: number
  deaths: number
  assists: number
  damageDealt: number
  goldEarned: number
  level: number
}
```

### 8.4 Client-Side Match Phase Handling

The client listens for phase transitions and switches its UI accordingly:

```typescript
// apps/web/src/game/core/match-phase-handler.ts

import { MatchPhase } from '@league/shared'

type PhaseChangeCallback = (phase: MatchPhase, data: unknown) => void

export class MatchPhaseHandler {
  private currentPhase: MatchPhase = 'loading'
  private listeners: PhaseChangeCallback[] = []

  onPhaseChange(callback: PhaseChangeCallback): () => void {
    this.listeners.push(callback)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback)
    }
  }

  /**
   * Called when the server sends a phase transition message.
   */
  handleServerPhaseChange(phase: MatchPhase, data: unknown): void {
    this.currentPhase = phase

    switch (phase) {
      case 'loading':
        // Show loading screen with progress bar
        break

      case 'countdown':
        // Hide loading screen, show game canvas with countdown overlay
        // Champions are visible but frozen
        break

      case 'in_progress':
        // Hide countdown overlay, enable input, start render loop
        break

      case 'ended':
        // Disable input, show victory/defeat screen with stats
        break

      case 'cleanup':
        // Transition back to lobby (React UI)
        break
    }

    for (const listener of this.listeners) {
      listener(phase, data)
    }
  }

  getPhase(): MatchPhase {
    return this.currentPhase
  }
}
```

---

## Summary

| System              | Key Detail                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| **Server loop**     | 30 Hz fixed timestep, 11 ordered phases per tick, accumulator-based catch-up                              |
| **Client loop**     | 60 fps via `requestAnimationFrame`, interpolates between server snapshots                                 |
| **State machine**   | 8 states per entity, strict capability matrix, external forced transitions for CC/death                   |
| **Attack timing**   | Windup (cancellable) / damage point (committed) / recovery (cancellable for orb-walking)                  |
| **Spell timing**    | Standard (cast/effect/recovery), instant, and channel variants                                            |
| **Turn order**      | Input first, movement before collision, damage before death, buffs before stats                           |
| **Game clock**      | Server-authoritative, deterministic (increments by fixed `TICK_DURATION_MS`), client syncs with smoothing |
| **Match lifecycle** | Loading / Countdown / InProgress / Ended / Cleanup with clear transitions                                 |
