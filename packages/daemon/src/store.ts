import { EventEmitter } from "node:events";
import { config } from "./config.js";
import { resolveProjectName } from "./project.js";
import type {
  AgentKind,
  HudState,
  NotifyLevel,
  NotifyState,
  Session,
  SessionStatus,
  SleepState,
  UsageState,
} from "./types.js";

/**
 * Single source of truth (vision.md §2). In-memory. Emits "change" on every
 * mutation so the WS layer can push the new snapshot to clients.
 */
class Store extends EventEmitter {
  private sessions = new Map<string, Session>();

  private sleep: SleepState = { idleAwake: false, clamshell: false };

  private usage: UsageState = { source: "none", updatedAt: nowIso() };

  private codexUsage: UsageState | undefined;

  private notify: NotifyState = { level: config.notifyLevel };

  /** Full snapshot, with stale sessions pruned. Sessions are returned in
   * creation order (Map insertion order) — the panel relies on this for a STABLE
   * layout: existing rows/cards never move, new ones append. An in-place update
   * (upsertSession on an existing id) keeps its position. */
  getState(): HudState {
    this.pruneStale();
    return {
      sleep: { ...this.sleep },
      sessions: [...this.sessions.values()],
      usage: { ...this.usage },
      codexUsage: this.codexUsage ? { ...this.codexUsage } : undefined,
      notify: { ...this.notify },
    };
  }

  setCodexUsage(usage: UsageState): void {
    this.codexUsage = usage;
    this.emitChange();
  }

  setNotifyLevel(level: NotifyLevel): void {
    if (this.notify.level === level) return;
    this.notify = { level };
    this.emitChange();
  }

  /** Create or update a session's status. Used by the hook ingestion layer.
   * Everything past status is optional metadata, bundled in `opts` so the
   * signature doesn't grow a param per vendor/feature. */
  upsertSession(
    sessionId: string,
    cwd: string,
    status: SessionStatus,
    opts: {
      lastMessage?: string;
      transcriptPath?: string;
      ancestorPids?: number[];
      agentPid?: number;
      agent?: AgentKind;
    } = {},
  ): void {
    const { lastMessage, transcriptPath, ancestorPids, agentPid, agent } = opts;
    const existing = this.sessions.get(sessionId);

    // Attention reason follows status: a hook-driven "waiting" is a permission
    // Notification; any other transition clears it so the scanner can own the
    // "question" reason.
    const attentionReason =
      status === "waiting" ? "notification" : undefined;

    const session: Session = {
      sessionId,
      cwd: cwd || existing?.cwd || "",
      projectName: cwd ? resolveProjectName(cwd) : (existing?.projectName ?? "unknown"),
      // Name only comes from statusLine; preserve it across hook updates.
      name: existing?.name,
      // Which tool drives this session — preserved once known; defaults Claude.
      agent: agent ?? existing?.agent ?? "claude-code",
      status,
      // Only overwrite lastMessage when a new one is supplied; otherwise keep it.
      lastMessage: lastMessage ?? existing?.lastMessage,
      attentionReason,
      transcriptPath: transcriptPath ?? existing?.transcriptPath,
      // PID chain is set once (SessionStart) and preserved across later hooks.
      ancestorPids: ancestorPids ?? existing?.ancestorPids,
      agentPid: agentPid ?? existing?.agentPid,
      updatedAt: nowIso(),
    };
    this.sessions.set(sessionId, session);

    // WS-churn guard: PreToolUse fires on every tool call. If nothing the user
    // can see changed (same status/message/name/project), refresh updatedAt
    // silently instead of pushing a new snapshot to every client. Exception:
    // first acquisition of the PID chain must propagate so click-to-session
    // works even if no visible field changed on that hook.
    const acquiredPids = !existing?.ancestorPids && !!session.ancestorPids;
    if (!acquiredPids && visiblyEqual(existing, session)) return;
    this.emitChange();
  }

  /**
   * Mark/clear a session's "waiting on a question" attention, driven by the
   * transcript scanner (AskUserQuestion/ExitPlanMode fire no hook — vision §7).
   * Only touches attention it OWNS (reason "question"); never overrides a
   * permission-prompt Notification.
   */
  setQuestionAttention(sessionId: string, waiting: boolean, label: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    if (waiting) {
      // Don't override an existing waiting (permission notification or already
      // a detected question).
      if (s.status === "waiting") return;
      this.sessions.set(sessionId, {
        ...s,
        status: "waiting",
        attentionReason: "question",
        lastMessage: label,
        updatedAt: nowIso(),
      });
      this.emitChange();
    } else {
      // Only clear waiting we set ourselves; leave permission-waiting be.
      if (s.status === "waiting" && s.attentionReason === "question") {
        this.sessions.set(sessionId, {
          ...s,
          status: "running",
          attentionReason: undefined,
          lastMessage: undefined,
          updatedAt: nowIso(),
        });
        this.emitChange();
      }
    }
  }

  /**
   * Acknowledge a session — the user clicked/opened it in the HUD. A "ready"
   * ("your move") session demotes to "idle": you've seen it, so it stops being
   * loud. This replaces the old time-based fade — "ready" now persists until you
   * actually engage (click here, or type in its terminal → running), never just
   * because minutes passed. No-op for any other status (waiting still needs a
   * real response; running/idle are unaffected).
   */
  acknowledgeSession(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s && s.status === "ready") {
      this.sessions.set(sessionId, { ...s, status: "idle", updatedAt: nowIso() });
      this.emitChange();
    }
  }

  /** Sessions the scanner should inspect (have a transcript on disk). */
  getScanTargets(): Array<{ sessionId: string; transcriptPath: string }> {
    const out: Array<{ sessionId: string; transcriptPath: string }> = [];
    for (const s of this.sessions.values()) {
      if (s.transcriptPath) {
        out.push({ sessionId: s.sessionId, transcriptPath: s.transcriptPath });
      }
    }
    return out;
  }

  /**
   * Attach the task name (and refresh project from cwd) for a session, from a
   * statusLine push. Does NOT change status — that's owned by hooks. Creates
   * the session if hooks haven't yet (or it predates hook install), defaulting
   * to "running" so already-live sessions still surface.
   */
  setSessionName(sessionId: string, name: string, cwd?: string): void {
    const existing = this.sessions.get(sessionId);
    // statusLine is ENRICHMENT, not a session source. Hooks own a session's
    // existence and status. If hooks haven't created this session, do nothing —
    // we have no trustworthy status for it, and inventing "running" produces
    // phantom sessions stuck running forever (a session that predates the hooks).
    if (!existing) return;
    // No-op if nothing actually changed (avoids needless WS pushes every tick).
    if (existing.name === name && (!cwd || existing.cwd === cwd)) return;

    this.sessions.set(sessionId, {
      ...existing,
      name,
      // Refresh project from cwd if the statusLine gives a better one.
      cwd: cwd ?? existing.cwd,
      projectName: cwd ? resolveProjectName(cwd) : existing.projectName,
      updatedAt: nowIso(),
    });
    this.emitChange();
  }

  removeSession(sessionId: string): void {
    if (this.sessions.delete(sessionId)) this.emitChange();
  }

  setSleep(partial: Partial<SleepState>): void {
    this.sleep = { ...this.sleep, ...partial };
    this.emitChange();
  }

  setUsage(usage: UsageState): void {
    this.usage = usage;
    this.emitChange();
  }

  private pruneStale(): void {
    const cutoff = Date.now() - config.sessionStaleMs;
    let changed = false;
    for (const [id, s] of this.sessions) {
      // Sessions whose claude PID we know are managed by the liveness sweep
      // (pruneDeadSessions) — never time-prune them, so an idle-but-alive agent
      // doesn't vanish when you step away or the Mac sleeps.
      if (s.agentPid) continue;
      if (Date.parse(s.updatedAt) < cutoff) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    // Don't emit from inside getState() to avoid re-entrancy; prune is silent.
    if (changed) queueMicrotask(() => this.emit("change"));
  }

  /**
   * Drop sessions whose `claude` process is gone (crash, quit, tab closed).
   * Called on a timer — this is the real "is it still running?" check, replacing
   * inactivity-based pruning for sessions we can track. Sessions without a known
   * agentPid (legacy/forwarder-less) fall back to pruneStale's time cutoff.
   */
  pruneDeadSessions(): void {
    let changed = false;
    for (const [id, s] of this.sessions) {
      if (s.agentPid && !isProcessAlive(s.agentPid)) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitChange();
  }

  private emitChange(): void {
    this.emit("change");
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/** True if a process with this PID exists. `kill(pid, 0)` sends no signal; it
 * throws ESRCH if the process is gone, EPERM if it exists but isn't ours (still
 * "alive"). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** True if two session snapshots are identical in everything the UI shows
 * (ignores updatedAt) — used to suppress no-op WS pushes from chatty hooks. */
function visiblyEqual(a: Session | undefined, b: Session): boolean {
  return (
    !!a &&
    a.status === b.status &&
    a.lastMessage === b.lastMessage &&
    a.name === b.name &&
    a.projectName === b.projectName &&
    a.agent === b.agent
  );
}

/** Singleton — the one shared state for the whole daemon. */
export const store = new Store();
