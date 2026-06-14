import WebSocket from "ws";
import type { HudState, SleepState } from "./types.js";

type Listener = (state: HudState) => void;
type FocusListener = (sessionId: string) => void;

/** Body shape for POST /sleep (daemon §4). Either field may be omitted. */
export interface SleepRequest {
  idle?: boolean;
  clamshell?: boolean;
}

/**
 * Thin client of the daemon (vision.md §2: "thin clients of the daemon").
 * Subscribes to WS /events for push updates and falls back to reconnect loops
 * when the daemon is down. All privileged work happens in the daemon — this
 * only reads /state and POSTs /sleep.
 */
export class DaemonClient {
  private ws: WebSocket | null = null;

  private listeners = new Set<Listener>();

  private focusListeners = new Set<FocusListener>();

  private reconnectTimer: NodeJS.Timeout | null = null;

  private disposed = false;

  /** Latest snapshot, or null until first message / if daemon is unreachable. */
  state: HudState | null = null;

  /** True while the WS is open — used to show a "daemon down" status. */
  connected = false;

  constructor(private baseUrl: string) {}

  onUpdate(listener: Listener): void {
    this.listeners.add(listener);
  }

  /** Cross-window focus requests broadcast by the daemon. */
  onFocus(listener: FocusListener): void {
    this.focusListeners.add(listener);
  }

  start(): void {
    this.connect();
  }

  private connect(): void {
    if (this.disposed) return;
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/events";
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on("open", () => {
      this.connected = true;
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // Control frames carry a `type`; state snapshots don't.
        if (msg && msg.type === "focus" && typeof msg.sessionId === "string") {
          for (const l of this.focusListeners) l(msg.sessionId);
          return;
        }
        this.state = msg as HudState;
        this.emit();
      } catch {
        /* ignore malformed frame */
      }
    });

    ws.on("close", () => {
      this.connected = false;
      this.emit(); // let the UI show the disconnected state
      this.scheduleReconnect();
    });

    ws.on("error", () => {
      // 'close' fires after 'error'; reconnect handled there.
      ws.terminate();
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  /** POST /sleep. Returns the new sleep state, or throws with the daemon error. */
  async setSleep(partial: SleepRequest): Promise<SleepState> {
    const res = await fetch(`${this.baseUrl}/sleep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    const json = (await res.json()) as { error?: string } & Partial<SleepState>;
    if (!res.ok) {
      throw new Error(json.error ?? `Daemon returned ${res.status}`);
    }
    return json as SleepState;
  }

  /** Ask the daemon to have whichever window owns this session focus it.
   * Returns whether some window claimed (handled) the request. */
  async requestFocus(sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/focus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const json = (await res.json()) as { claimed?: boolean };
      return !!json.claimed;
    } catch {
      return false;
    }
  }

  /** Set the OS-notification level on the daemon. */
  async setNotify(level: "off" | "waiting" | "all"): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      });
    } catch {
      /* daemon down — ignore */
    }
  }

  /** This window owns the session's terminal — tell the daemon to raise us. */
  async claimFocus(sessionId: string, folder: string | undefined): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/focus/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, folder }),
      });
    } catch {
      /* daemon down — nothing to raise */
    }
  }

  private emit(): void {
    if (this.state) for (const l of this.listeners) l(this.state);
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
