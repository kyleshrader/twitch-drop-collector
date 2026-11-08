import { describe, expect, it } from 'vitest'
import {
  dropOn,
  movePiece,
  placeAfter,
  placeBefore,
  splitMove,
  takenBy,
  toTop,
  type PieceIds
} from './queue-ops'

// Rust has two campaigns (r1, r2) in one card, then Rocket League (k), then Marvel (m). The
// current campaign (cur) is in the order but not in any card.
const order = ['cur', 'r1', 'r2', 'k', 'm']
const pieces: PieceIds[] = [
  { key: 'r1', ids: ['r1', 'r2'] },
  { key: 'k', ids: ['k'] },
  { key: 'm', ids: ['m'] }
]

describe('placing', () => {
  it('moves IDs before or after others, keeping their order', () => {
    expect(placeBefore(order, ['k', 'm'], 'r1')).toEqual(['cur', 'k', 'm', 'r1', 'r2'])
    expect(placeBefore(order, ['r1'], undefined)).toEqual(['cur', 'r2', 'k', 'm', 'r1'])
    expect(placeAfter(order, ['r1', 'r2'], ['k'])).toEqual(['cur', 'k', 'r1', 'r2', 'm'])
  })
})

describe('moving a card', () => {
  it('moves past its neighbour, or not at all at the ends', () => {
    expect(movePiece(order, pieces, 'k', -1)).toEqual(['cur', 'k', 'r1', 'r2', 'm'])
    expect(movePiece(order, pieces, 'r1', 1)).toEqual(['cur', 'k', 'r1', 'r2', 'm'])
    expect(movePiece(order, pieces, 'r1', -1)).toBeUndefined()
    expect(movePiece(order, pieces, 'm', 1)).toBeUndefined()
  })
})

describe('splitting a card', () => {
  it('up takes the campaign and the ones above it; down, it and the ones below', () => {
    expect(takenBy(pieces[0]!, 'r1', -1)).toEqual(['r1'])
    expect(takenBy(pieces[0]!, 'r2', -1)).toEqual(['r1', 'r2'])
    expect(takenBy(pieces[0]!, 'r1', 1)).toEqual(['r1', 'r2'])
    expect(takenBy(pieces[0]!, 'r2', 1)).toEqual(['r2'])
  })

  it('moves the part it takes past the neighbouring card', () => {
    // Rust for creator Y after Rocket League, Rust for creator X stays first.
    expect(splitMove(order, pieces, 'r1', 'r2', 1)).toEqual(['cur', 'r1', 'k', 'r2', 'm'])
    const split: PieceIds[] = [
      { key: 'r1', ids: ['r1'] },
      { key: 'k', ids: ['k'] },
      { key: 'r2', ids: ['r2'] }
    ]
    expect(splitMove(['r1', 'k', 'r2'], split, 'r2', 'r2', -1)).toEqual(['r1', 'r2', 'k'])
    expect(splitMove(order, pieces, 'r1', 'r1', -1)).toBeUndefined()
  })
})

describe('drag and drop', () => {
  it('drops before or after a card', () => {
    expect(dropOn(order, pieces, ['m'], { key: 'r1', where: 'before' })).toEqual([
      'cur',
      'm',
      'r1',
      'r2',
      'k'
    ])
    expect(dropOn(order, pieces, ['r2'], { key: 'k', where: 'after' })).toEqual([
      'cur',
      'r1',
      'k',
      'r2',
      'm'
    ])
  })

  it('leaves the order alone when a card is dropped on itself', () => {
    expect(dropOn(order, pieces, ['r1', 'r2'], { key: 'r1', where: 'after' })).toEqual(order)
  })
})

it('Collect now puts a campaign at the very top', () => {
  expect(toTop(order, 'm')).toEqual(['m', 'cur', 'r1', 'r2', 'k'])
})
