import { useState } from 'react';
import type { ClawHistoryEntry } from '../../../api/endpoints/claws';
import type { AuditEntry } from './AuditTab';
import { LoadingSpinner } from '../../../components/LoadingSpinner';
import { CheckCircle2, XCircle } from '../../../components/icons';
import { formatDuration, formatCost, timeAgo } from '../utils';

const CYCLE_BAR_COLOR: Record<string, string> = {
  success: 'bg-green-500',
  failed: 'bg-red-500',
  error: 'bg-amber-500',
  escalation: 'bg-purple-500',
  default: 'bg-blue-500',
};

type RunsSubTab = 'history' | 'timeline' | 'audit';

export function RunsTab({
  history,
  historyTotal,
  isLoadingHistory,
  loadHistory,
  auditEntries,
  auditTotal,
  auditFilter,
  setAuditFilter,
  isLoadingAudit,
}: {
  history: ClawHistoryEntry[];
  historyTotal: number;
  isLoadingHistory: boolean;
  loadHistory: () => void;
  auditEntries: AuditEntry[];
  auditTotal: number;
  auditFilter: string;
  setAuditFilter: (f: string) => void;
  isLoadingAudit: boolean;
  loadAudit: (filter?: string) => void;
}) {
  const [subTab, setSubTab] = useState<RunsSubTab>('history');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'success' | 'failed'>('all');

  const filteredHistory =
    historyFilter === 'all'
      ? history
      : history.filter((e) => (historyFilter === 'success' ? e.success : !e.success));

  const maxDuration = Math.max(...history.map((e) => e.durationMs), 1);

  return (
    <div className="space-y-3">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 border-b border-border dark:border-dark-border pb-2">
        {(['history', 'timeline', 'audit'] as RunsSubTab[]).map((s) => (
          <button
            key={s}
            onClick={() => setSubTab(s)}
            className={`px-3 py-1 text-xs font-medium rounded ${
              subTab === s
                ? 'bg-primary/10 text-primary'
                : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* History sub-tab */}
      {subTab === 'history' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              {historyTotal} cycles
            </p>
            <select
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value as typeof historyFilter)}
              className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
            >
              <option value="all">All</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          {isLoadingHistory ? (
            <LoadingSpinner message="Loading history..." />
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {filteredHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 p-2 rounded border border-border dark:border-dark-border text-xs"
                >
                  {entry.success ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-text-secondary dark:text-dark-text-secondary font-medium">
                        Cycle {entry.cycleNumber}
                      </span>
                      <span className="text-text-muted dark:text-dark-text-muted">
                        {timeAgo(entry.executedAt)}
                      </span>
                      <span className="text-text-muted dark:text-dark-text-muted">
                        {formatDuration(entry.durationMs)}
                      </span>
                      {entry.costUsd != null && (
                        <span className="text-text-muted dark:text-dark-text-muted">
                          {formatCost(entry.costUsd)}
                        </span>
                      )}
                    </div>
                    <p className="text-text-muted dark:text-dark-text-muted truncate mt-0.5">
                      {entry.outputMessage.slice(0, 100)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Timeline sub-tab */}
      {subTab === 'timeline' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              {historyTotal} cycles — bar width = relative duration
            </p>
            <button onClick={loadHistory} className="text-xs text-primary hover:underline">
              Refresh
            </button>
          </div>
          {isLoadingHistory ? (
            <LoadingSpinner message="Loading..." />
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {[...history].reverse().map((entry) => {
                const barWidth = Math.max((entry.durationMs / maxDuration) * 100, 4);
                const color =
                  CYCLE_BAR_COLOR[entry.error ? 'error' : entry.success ? 'success' : 'failed'];
                return (
                  <div key={entry.id} className="flex items-center gap-2 text-xs">
                    <span className="w-12 text-text-muted dark:text-dark-text-muted shrink-0">
                      #{entry.cycleNumber}
                    </span>
                    <div className="flex-1 h-3 rounded-full bg-border dark:bg-dark-border overflow-hidden">
                      <div
                        className={`h-full rounded-full ${color}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <span className="w-24 text-right text-text-muted dark:text-dark-text-muted">
                      {formatDuration(entry.durationMs)}
                    </span>
                    {entry.costUsd != null && (
                      <span className="w-16 text-right text-text-muted dark:text-dark-text-muted">
                        {formatCost(entry.costUsd)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Audit sub-tab */}
      {subTab === 'audit' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              {auditTotal} entries
            </p>
            <input
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              placeholder="Filter by tool or category..."
              className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary w-48"
            />
          </div>
          {isLoadingAudit ? (
            <LoadingSpinner message="Loading audit..." />
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {auditEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 p-2 rounded border border-border dark:border-dark-border text-xs"
                >
                  {entry.success ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-text-primary dark:text-dark-text-primary">
                        {entry.toolName}
                      </span>
                      <span className="text-text-muted dark:text-dark-text-muted">
                        #{entry.cycleNumber}
                      </span>
                      <span className="text-text-muted dark:text-dark-text-muted">
                        {formatDuration(entry.durationMs)}
                      </span>
                    </div>
                    <p className="text-text-muted dark:text-dark-text-muted truncate">
                      {entry.toolResult.slice(0, 80)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
