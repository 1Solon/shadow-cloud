import { Allow } from 'class-validator';
import type { SeatOrderBaseline } from '../games.types';

export class ReorderSeatOrderDto {
  // Whitelist only: the owner checks authorization and baseline before intent,
  // so malformed intent cannot hide a stale draft or lost permissions.
  @Allow()
  baseline!: SeatOrderBaseline;

  @Allow()
  seatEntryIds!: string[];

  @Allow()
  clearedSeatEntryIds?: string[];

  @Allow()
  removedSeatEntryIds?: string[];

  @Allow()
  activePlayerEntryId?: string;
}
