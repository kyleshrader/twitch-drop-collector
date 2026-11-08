// Reordering Up next. Every move produces a whole new campaign order; main stores it and builds
// the pieces again (docs/new-ui/queue-rules.md), so these only shuffle IDs. Pieces merge by
// themselves when same-game campaigns end up next to each other.

/** What the moves need of a card: its key and its campaigns, in order. */
export interface PieceIds {
  key: string
  ids: readonly string[]
}

export type Direction = -1 | 1

/** Moves `moving` (in their order) to just before `before`, or to the end. */
export function placeBefore(
  order: readonly string[],
  moving: readonly string[],
  before: string | undefined
): string[] {
  const set = new Set(moving)
  const rest = order.filter((id) => !set.has(id))
  const at = before === undefined ? -1 : rest.indexOf(before)
  if (at === -1) return [...rest, ...moving]
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)]
}

/** Moves `moving` to just after the last of `after`. */
export function placeAfter(
  order: readonly string[],
  moving: readonly string[],
  after: readonly string[]
): string[] {
  const set = new Set(moving)
  const rest = order.filter((id) => !set.has(id))
  const last = Math.max(-1, ...after.map((id) => rest.indexOf(id)))
  if (last === -1) return [...rest, ...moving]
  return [...rest.slice(0, last + 1), ...moving, ...rest.slice(last + 1)]
}

/** A card moves past its neighbour. Undefined when it's already at that end. */
export function movePiece(
  order: readonly string[],
  pieces: readonly PieceIds[],
  key: string,
  direction: Direction
): string[] | undefined {
  const i = pieces.findIndex((p) => p.key === key)
  const neighbour = pieces[i + direction]
  const piece = pieces[i]
  if (!piece || !neighbour) return undefined
  return direction < 0
    ? placeBefore(order, piece.ids, neighbour.ids[0])
    : placeAfter(order, piece.ids, neighbour.ids)
}

/**
 * The campaigns a move from inside a card takes: up takes it and the ones above it in the card,
 * down takes it and the ones below.
 */
export function takenBy(piece: PieceIds, campaignId: string, direction: Direction): string[] {
  const at = piece.ids.indexOf(campaignId)
  if (at === -1) return []
  return direction < 0 ? piece.ids.slice(0, at + 1) : piece.ids.slice(at)
}

/** Splits the card at a campaign and moves that part past the neighbouring card. */
export function splitMove(
  order: readonly string[],
  pieces: readonly PieceIds[],
  key: string,
  campaignId: string,
  direction: Direction
): string[] | undefined {
  const i = pieces.findIndex((p) => p.key === key)
  const piece = pieces[i]
  const neighbour = pieces[i + direction]
  if (!piece || !neighbour) return undefined
  const taken = takenBy(piece, campaignId, direction)
  if (taken.length === 0) return undefined
  return direction < 0
    ? placeBefore(order, taken, neighbour.ids[0])
    : placeAfter(order, taken, neighbour.ids)
}

/** Where a drag ends: before or after a card. */
export interface DropTarget {
  key: string
  where: 'before' | 'after'
}

/** Drops `moving` before or after a card (a drop onto its own card leaves the order alone). */
export function dropOn(
  order: readonly string[],
  pieces: readonly PieceIds[],
  moving: readonly string[],
  target: DropTarget
): string[] {
  const piece = pieces.find((p) => p.key === target.key)
  if (!piece) return [...order]
  const others = piece.ids.filter((id) => !moving.includes(id))
  if (others.length === 0) return [...order]
  return target.where === 'before'
    ? placeBefore(order, moving, others[0])
    : placeAfter(order, moving, others)
}

/** Collect now in a custom order: the campaign goes to the very top. */
export const toTop = (order: readonly string[], campaignId: string): string[] =>
  placeBefore(order, [campaignId], order[0])
