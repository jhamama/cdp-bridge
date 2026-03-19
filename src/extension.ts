import * as vscode from 'vscode';
import { CDPManager } from './bridge/cdp';
import { NetworkLog } from './bridge/networkLog';
import { BridgeServer } from './bridge/server';
import { StatusBar } from './ui/statusBar';

let cdpManager: CDPManager | null = null;
let bridgeServer: BridgeServer | null = null;
let statusBar: StatusBar | null = null;
let outputChannel: vscode.OutputChannel | null = null;

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('cdpBridge');
  return {
    chromePort: cfg.get<number>('chromePort', 9222),
    serverPort: cfg.get<number>('serverPort', 3000),
    networkLogSize: cfg.get<number>('networkLogSize', 200),
    autoStart: cfg.get<boolean>('autoStart', true),
    reconnectInterval: cfg.get<number>('reconnectInterval', 3000),
  };
}

async function startBridge() {
  if (bridgeServer || cdpManager) {
    vscode.window.showWarningMessage('CDP Bridge is already running.');
    return;
  }
  const config = getConfig();
  outputChannel!.appendLine('[Extension] Starting CDP Bridge...');

  const networkLog = new NetworkLog(config.networkLogSize);
  cdpManager = new CDPManager(config.chromePort, config.reconnectInterval, networkLog, outputChannel!);
  bridgeServer = new BridgeServer(config.serverPort, cdpManager, outputChannel!);
  statusBar!.updatePort(config.serverPort);

  cdpManager.onStatusChange((status) => {
    statusBar!.update(status, true);
  });

  try {
    await bridgeServer.start();
    statusBar!.update('disconnected', true);
    await cdpManager.connect();
  } catch (e: any) {
    outputChannel!.appendLine(`[Extension] Failed to start: ${e.message}`);
    vscode.window.showErrorMessage(`CDP Bridge failed to start: ${e.message}`);
    await stopBridge();
  }
}

async function stopBridge() {
  if (cdpManager) {
    await cdpManager.disconnect();
    cdpManager = null;
  }
  if (bridgeServer) {
    await bridgeServer.stop();
    bridgeServer = null;
  }
  statusBar?.update('disconnected', false);
  outputChannel!.appendLine('[Extension] CDP Bridge stopped.');
}

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('CDP Bridge');
  const config = getConfig();
  statusBar = new StatusBar(config.serverPort);

  context.subscriptions.push(
    outputChannel,
    statusBar,
    vscode.commands.registerCommand('cdpBridge.start', startBridge),
    vscode.commands.registerCommand('cdpBridge.stop', async () => {
      await stopBridge();
      vscode.window.showInformationMessage('CDP Bridge stopped.');
    }),
    vscode.commands.registerCommand('cdpBridge.reconnect', async () => {
      if (!cdpManager) {
        vscode.window.showWarningMessage('CDP Bridge is not running. Use Start first.');
        return;
      }
      await cdpManager.reconnect();
    }),
    vscode.commands.registerCommand('cdpBridge.status', async () => {
      const isRunning = !!bridgeServer;
      const cdpStatus = cdpManager?.getStatus() ?? 'disconnected';
      const tab = cdpManager?.getActiveTab();
      const items: vscode.QuickPickItem[] = [
        { label: `Server: ${isRunning ? `Running on :${config.serverPort}` : 'Stopped'}` },
        { label: `CDP: ${cdpStatus}` },
        { label: `Active Tab: ${tab?.url ?? 'none'}` },
        { label: '---', kind: vscode.QuickPickItemKind.Separator },
        isRunning
          ? { label: '$(debug-stop) Stop CDP Bridge', description: 'Stop server and disconnect' }
          : { label: '$(play) Start CDP Bridge', description: 'Start server and connect to Chrome' },
        ...(isRunning ? [{ label: '$(refresh) Reconnect CDP', description: 'Reconnect to Chrome' }] : []),
      ];
      const choice = await vscode.window.showQuickPick(items, { title: 'CDP Bridge' });
      if (!choice) return;
      if (choice.label.includes('Stop')) await vscode.commands.executeCommand('cdpBridge.stop');
      else if (choice.label.includes('Start')) await vscode.commands.executeCommand('cdpBridge.start');
      else if (choice.label.includes('Reconnect')) await vscode.commands.executeCommand('cdpBridge.reconnect');
    }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('cdpBridge') && bridgeServer) {
        const restart = await vscode.window.showInformationMessage(
          'CDP Bridge configuration changed. Restart to apply?',
          'Restart', 'Later'
        );
        if (restart === 'Restart') {
          await stopBridge();
          await startBridge();
        }
      }
    }),
  );

  if (config.autoStart) {
    await startBridge();
  }
}

export async function deactivate() {
  await stopBridge();
}
