-- Internal mutation revision. Seat Order freshness is not enabled until all
-- relevant writers participate; existing roster and history remain untouched.
ALTER TABLE "Game" ADD COLUMN "turnRevision" INTEGER NOT NULL DEFAULT 0;
