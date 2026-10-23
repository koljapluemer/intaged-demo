import { describe, expect, it } from 'vitest'
import { QueueFullError, WorkQueue } from './concurrency.js'

describe('WorkQueue', () => {
  it('limits active and queued work', async () => {
    const queue = new WorkQueue(1, 1)
    let release!: () => void
    const blocked = new Promise<void>((resolve) => (release = resolve))
    const first = queue.run(() => blocked)
    const second = queue.run(async () => 'second')
    await expect(queue.run(async () => 'third')).rejects.toBeInstanceOf(QueueFullError)
    expect(queue.stats).toEqual({ active: 1, waiting: 1 })
    release()
    await first
    await expect(second).resolves.toBe('second')
  })
})
