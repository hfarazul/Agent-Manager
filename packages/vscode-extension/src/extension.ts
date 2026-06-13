import * as vscode from "vscode";
import { DaemonClient, type SleepRequest } from "./client.js";
import { statusBarText, statusBarTooltip } from "./format.js";
import { panelHtml } from "./panel.js";

let client: DaemonClient;
let statusBar: vscode.StatusBarItem;
let provider: HudViewProvider;

/** Project names the user has folded in the panel. Held here (not in the
 * webview) so collapse survives the wholesale re-render on every poll. */
const collapsedGroups = new Set<string>();

export function activate(context: vscode.ExtensionContext): void {
  const baseUrl = vscode.workspace
    .getConfiguration("agentHud")
    .get<string>("daemonUrl", "http://127.0.0.1:7842");

  client = new DaemonClient(baseUrl);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "agentHud.openPanel";
  statusBar.show();

  provider = new HudViewProvider();

  client.onUpdate(render);
  client.start();
  render();

  // Keep relative times (ages, reset countdowns) ticking even when the daemon
  // state itself hasn't changed.
  const tick = setInterval(render, 5000);

  context.subscriptions.push(
    statusBar,
    { dispose: () => client.dispose() },
    { dispose: () => clearInterval(tick) },
    vscode.window.registerWebviewViewProvider("agentHud.view", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("agentHud.openPanel", () =>
      vscode.commands.executeCommand("agentHud.view.focus"),
    ),
    vscode.commands.registerCommand("agentHud.toggleSleep", toggleSleep),
  );
}

export function deactivate(): void {
  client?.dispose();
}

function render(): void {
  statusBar.text = statusBarText(client.state, client.connected);
  statusBar.tooltip = statusBarTooltip(client.state, client.connected);
  provider?.render();
}

/**
 * The HUD lives as a sidebar view (Activity Bar container) — NOT an editor
 * panel — so it never consumes an editor column or fights the terminal. The
 * user can drag it to the secondary side bar if they prefer.
 */
class HudViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage(handleMessage);
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
    this.render();
  }

  render(): void {
    if (this.view) {
      this.view.webview.html = panelHtml(client.state, client.connected, collapsedGroups);
    }
  }
}

async function handleMessage(m: {
  cmd: string;
  level?: number;
  group?: string;
  value?: boolean;
}): Promise<void> {
  if (m.cmd === "sleepLevel") {
    // Segmented control: 0 = sleep, 1 = awake (lid open), 2 = + clamshell.
    const level = m.level ?? 0;
    await applySleep({ idle: level >= 1, clamshell: level >= 2 });
  } else if (m.cmd === "toggleGroup" && m.group) {
    if (collapsedGroups.has(m.group)) collapsedGroups.delete(m.group);
    else collapsedGroups.add(m.group);
    provider.render();
  } else if (m.cmd === "clamshell" || m.cmd === "idle") {
    // Legacy single-toggle protocol — kept as a defensive fallback.
    await applySleep(m.cmd === "clamshell" ? { clamshell: !!m.value } : { idle: !!m.value });
  }
}

/** Quick-pick toggle for the command palette / status-bar fallback. */
async function toggleSleep(): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: "Keep awake (lid open)", key: "idle" as const },
      { label: "Keep awake (lid closed)", key: "clamshell" as const },
    ],
    { placeHolder: "Toggle which keep-awake mechanism?" },
  );
  if (!pick) return;
  const current = client.state?.sleep;
  const on = pick.key === "idle" ? !current?.idleAwake : !current?.clamshell;
  await applySleep(pick.key === "idle" ? { idle: on } : { clamshell: on });
}

async function applySleep(partial: SleepRequest): Promise<void> {
  try {
    await client.setSleep(partial);
  } catch (err) {
    vscode.window.showErrorMessage(`Agent HUD: ${(err as Error).message}`);
  }
}
