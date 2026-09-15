/** A minimal LockManager: enough of the Web Locks API for a test to hold and query a lock. */
export class FakeLockManager implements LockManager {
  private readonly held = new Set<string>()
  private readonly queues = new Map<string, Array<() => void>>()

  request<T>(name: string, callback: LockGrantedCallback<T>): Promise<T>
  request<T>(name: string, options: LockOptions, callback: LockGrantedCallback<T>): Promise<T>
  async request<T>(
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<T>,
    maybeCallback?: LockGrantedCallback<T>,
  ): Promise<T> {
    const callback = maybeCallback ?? (optionsOrCallback as LockGrantedCallback<T>)
    await this.acquire(name)
    try {
      return await callback({ name, mode: 'exclusive' })
    } finally {
      this.release(name)
    }
  }

  // Marks the name held synchronously, before any await, so two requests issued in the
  // same microtask cannot both see the name as free and both proceed as if granted.
  private acquire(name: string): Promise<void> {
    if (!this.held.has(name)) {
      this.held.add(name)
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      const queue = this.queues.get(name) ?? []
      queue.push(resolve)
      this.queues.set(name, queue)
    })
  }

  private release(name: string): void {
    const queue = this.queues.get(name)
    const next = queue?.shift()
    if (next) {
      // Ownership passes directly to the next waiter; the name stays held throughout.
      next()
    } else {
      this.held.delete(name)
    }
  }

  async query(): Promise<LockManagerSnapshot> {
    const pending: LockInfo[] = []
    for (const [name, queue] of this.queues) {
      for (let i = 0; i < queue.length; i++) pending.push({ name, mode: 'exclusive' as const })
    }
    return {
      held: [...this.held].map((name) => ({ name, mode: 'exclusive' as const })),
      pending,
    }
  }
}
