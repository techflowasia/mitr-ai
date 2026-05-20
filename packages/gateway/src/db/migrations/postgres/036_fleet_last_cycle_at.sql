-- Add last_cycle_at column to fleet_sessions for orphan detection
-- This column tracks when the fleet last ran a cycle, used by getOrphanedSessions()
ALTER TABLE fleet_sessions ADD COLUMN IF NOT EXISTS last_cycle_at TIMESTAMPTZ;