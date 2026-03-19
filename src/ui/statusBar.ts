import * as vscode from 'vscode';
import { CDPStatus } from '../bridge/cdp';

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private serverPort: number;
  private serverRunning = false;

  constructor(serverPort: number) {
    this.serverPort = serverPort;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'cdpBridge.status';
    this.update('disconnected', false);
    this.item.show();
  }

  update(cdpStatus: CDPStatus, serverRunning: boolean) {
    this.serverRunning = serverRunning;
    if (!serverRunning) {
      this.item.text = '$(circle-slash) CDP Bridge Off';
      this.item.color = new vscode.ThemeColor('statusBar.foreground');
      this.item.tooltip = 'CDP Bridge is stopped. Click to manage.';
    } else if (cdpStatus === 'connected') {
      this.item.text = `$(broadcast) CDP Bridge :${this.serverPort}`;
      this.item.color = '#73C991';
      this.item.tooltip = `CDP Bridge running on port ${this.serverPort}. Click to manage.`;
    } else if (cdpStatus === 'error' || cdpStatus === 'connecting') {
      this.item.text = '$(warning) CDP Bridge Error';
      this.item.color = '#E2C08D';
      this.item.tooltip = `CDP Bridge: ${cdpStatus}. Click to manage.`;
    } else {
      this.item.text = '$(warning) CDP Bridge Disconnected';
      this.item.color = '#E2C08D';
      this.item.tooltip = 'CDP not connected. Click to manage.';
    }
  }

  updatePort(port: number) {
    this.serverPort = port;
  }

  dispose() {
    this.item.dispose();
  }
}
