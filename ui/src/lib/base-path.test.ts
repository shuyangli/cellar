import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cellarPath,
  normalizeCellarBasePath,
  readCellarBasePath,
} from './base-path'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cellar base path', () => {
  it('normalizes an injected reverse-proxy prefix', () => {
    expect(normalizeCellarBasePath('cellar/')).toBe('/cellar')
    expect(normalizeCellarBasePath('/cellar///')).toBe('/cellar')
    expect(normalizeCellarBasePath('')).toBe('')
  })

  it('reads the runtime prefix injected into the page', () => {
    vi.stubGlobal('window', { __CELLAR_BASE_PATH__: '/cellar/' })
    expect(readCellarBasePath()).toBe('/cellar')
  })

  it('prefixes root-relative API and photo paths', () => {
    expect(cellarPath('/api/cellar', '/cellar')).toBe('/cellar/api/cellar')
    expect(cellarPath('/photos/label.jpg', '/cellar')).toBe(
      '/cellar/photos/label.jpg',
    )
    expect(cellarPath('/api/cellar', '')).toBe('/api/cellar')
  })
})
