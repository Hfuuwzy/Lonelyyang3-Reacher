import type { PaperTaskBranch, PaperTaskEvent } from '../../app/utils/paper-task-contract'

export type QueueItem =
  | { readonly kind: 'event'; readonly event: PaperTaskEvent }
  | { readonly kind: 'done'; readonly branch: PaperTaskBranch; readonly ok: boolean; readonly state: 'sample-ready' | 'preview-ready' | 'needs-confirmation' | 'complete' }

export class EventQueue<T = QueueItem> {
  private readonly items: T[] = []
  private readonly waiters: Array<(item: T) => void> = []

  push(item: T): void {
    const waiter = this.waiters.shift()
    if (waiter !== undefined) {
      waiter(item)
      return
    }
    this.items.push(item)
  }

  take(): Promise<T> {
    const item = this.items.shift()
    if (item !== undefined) {
      return Promise.resolve(item)
    }
    return new Promise<T>((resolveTake) => {
      this.waiters.push(resolveTake)
    })
  }
}

export function takeOrAbort<T>(queue: EventQueue<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) {
    return Promise.resolve(undefined)
  }
  return new Promise((resolveTake) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      resolveTake(undefined)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    queue.take().then((item) => {
      signal.removeEventListener('abort', onAbort)
      resolveTake(item)
    })
  })
}
