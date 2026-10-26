export class QueueFullError extends Error {}

export class WorkQueue {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(
    private readonly concurrency: number,
    private readonly maxWaiting: number,
  ) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maxWaiting) throw new QueueFullError('Too many widgets are being generated right now. Try again in a minute.')
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }

    this.active++
    try {
      return await work()
    } finally {
      this.active--
      this.waiting.shift()?.()
    }
  }

  get full() {
    return this.active >= this.concurrency && this.waiting.length >= this.maxWaiting
  }

  get stats() {
    return { active: this.active, waiting: this.waiting.length }
  }
}
