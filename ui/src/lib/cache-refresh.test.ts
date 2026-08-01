import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchStats } from './cellar'
import { installResumeRefresh } from './resume-refresh'

describe('fresh cellar data', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('bypasses the browser cache for API reads', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({}),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchStats()

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/stats$/),
      { cache: 'no-store' },
    )
  })

  it('refreshes route data when the app returns to the foreground', () => {
    const refresh = vi.fn()
    let visibilityState: DocumentVisibilityState = 'hidden'
    const documentTarget = new EventTarget()
    const windowTarget = new EventTarget()
    const documentLike = {
      get visibilityState() {
        return visibilityState
      },
      addEventListener: documentTarget.addEventListener.bind(documentTarget),
      removeEventListener:
        documentTarget.removeEventListener.bind(documentTarget),
    }

    const cleanup = installResumeRefresh(
      refresh,
      documentLike,
      windowTarget,
    )

    documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).not.toHaveBeenCalled()

    visibilityState = 'visible'
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)

    cleanup()
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes a page restored from Safari back-forward cache', () => {
    const refresh = vi.fn()
    const documentTarget = Object.assign(new EventTarget(), {
      visibilityState: 'visible' as const,
    })
    const windowTarget = new EventTarget()
    const cleanup = installResumeRefresh(
      refresh,
      documentTarget,
      windowTarget,
    )
    const event = new Event('pageshow')
    Object.defineProperty(event, 'persisted', { value: true })

    windowTarget.dispatchEvent(event)
    expect(refresh).toHaveBeenCalledTimes(1)
    cleanup()
  })
})
