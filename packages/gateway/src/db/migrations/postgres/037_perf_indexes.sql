-- 037_perf_indexes.sql
-- Hot-path indexes that match the actual query shapes used by
-- FleetManager.tick() and the trigger dispatch loop.
--
-- Both queries today rely on single-column indexes that the planner
-- has to combine + sort over. With realistic row counts (queued
-- tasks per fleet, total enabled schedule triggers) these turn into
-- visible CPU floors in the polling loops.

-- FleetManager.tick() calls FleetRepository.getReadyTasks(fleetId, limit)
-- which runs: WHERE fleet_id = $1 AND status = 'queued' ORDER BY priority, created_at
-- Existing indexes are on (fleet_id) and (status) separately. The composite
-- lets Postgres filter on both predicates from a single index scan.
CREATE INDEX IF NOT EXISTS idx_fleet_tasks_fleet_status
  ON fleet_tasks(fleet_id, status);

-- TriggersRepository.getDueTriggers() runs:
-- WHERE user_id = $1 AND enabled = true AND type = 'schedule'
--   AND next_fire IS NOT NULL AND next_fire <= $2
-- The existing idx_triggers_next_fire(next_fire) full-column index also
-- contains disabled / non-schedule / never-scheduled rows. A partial
-- index keeps only candidates, shrinking the polling scan dramatically
-- as users accumulate disabled or event-type triggers.
CREATE INDEX IF NOT EXISTS idx_triggers_due
  ON triggers(user_id, next_fire)
  WHERE enabled = true AND type = 'schedule' AND next_fire IS NOT NULL;

-- ChannelMessagesRepository hot queries:
--   getByChannel / getRecent / getAll({channelId}) — every Inbox page load:
--     WHERE channel_id = $1 ORDER BY created_at DESC LIMIT/OFFSET
--   getByConversation — every chat-thread render:
--     WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT/OFFSET
-- Existing indexes are (channel_id) and (created_at) separately, and
-- conversation_id has no index at all. The composites match the ORDER BY
-- so Postgres returns rows in index order without a sort step.
CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_created
  ON channel_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_messages_conversation_created
  ON channel_messages(conversation_id, created_at)
  WHERE conversation_id IS NOT NULL;
