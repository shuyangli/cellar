import { describe, expect, it } from 'vitest'

import {
  cellarPath,
  normalizeCellarBasePath,
  readCellarBasePath,
} from './base-path'

describe('cellar base path', () => {
  it('normalizes an injected reverse-proxy prefix', () => {
    expect(normalizeCellarBasePath('cellar/')).toBe('/cellar')
    expect(normalizeCellarBasePath('/cellar///')).toBe('/cellar')
    expect(normalizeCellarBasePath('')).toBe('')
  })

  it('defaults to the root deployment when no build prefix is configured', () => {
    expect(readCellarBasePath()).toBe('')
  })

  it('prefixes root-relative API and photo paths', () => {
    expect(cellarPath('/api/cellar', '/cellar')).toBe('/cellar/api/cellar')
    expect(cellarPath('/photos/label.jpg', '/cellar')).toBe(
      '/cellar/photos/label.jpg',
    )
    expect(cellarPath('/api/cellar', '')).toBe('/api/cellar')
  })
})
