import type { ClientMessageType } from '@template-dev/shared'

export interface QueuedInput {
  playerId: string
  type: ClientMessageType
  payload: unknown
  receivedAt: number
  clientTick: number
  sequenceNumber: number
}

export class InputQueue {
  private queue: QueuedInput[] = []

  enqueue(input: QueuedInput): void {
    this.queue.push(input)
  }

  /** Drain all queued inputs, sorted by receive time for determinism */
  drain(): QueuedInput[] {
    const inputs = this.queue
      .splice(0, this.queue.length)
      .sort((a, b) => a.receivedAt - b.receivedAt)
    return inputs
  }

  get length(): number {
    return this.queue.length
  }
}
