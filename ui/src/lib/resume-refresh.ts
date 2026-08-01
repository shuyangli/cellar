type EventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
type VisibilitySource = EventSource & Pick<Document, 'visibilityState'>

/**
 * Refresh route loaders when a mobile browser resumes the app or restores it
 * from the back-forward cache. Returns an unsubscriber for React effects.
 */
export function installResumeRefresh(
  refresh: () => void | Promise<void>,
  documentSource: VisibilitySource = document,
  windowSource: EventSource = window,
): () => void {
  const refreshNow = () => {
    void refresh()
  }
  const onVisibilityChange = () => {
    if (documentSource.visibilityState === 'visible') refreshNow()
  }
  const onPageShow = (event: Event) => {
    if ('persisted' in event && event.persisted === true) refreshNow()
  }

  documentSource.addEventListener('visibilitychange', onVisibilityChange)
  windowSource.addEventListener('pageshow', onPageShow)

  return () => {
    documentSource.removeEventListener('visibilitychange', onVisibilityChange)
    windowSource.removeEventListener('pageshow', onPageShow)
  }
}
