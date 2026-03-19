import * as http from 'http';
import * as vscode from 'vscode';
import { NetworkLog } from './networkLog';

// We use require for chrome-remote-interface as it has no great TS types included
const CDP = require('chrome-remote-interface');

export type CDPStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export class CDPManager {
  private client: any = null;
  private status: CDPStatus = 'disconnected';
  private chromePort: number;
  private reconnectInterval: number;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private outputChannel: vscode.OutputChannel;
  public networkLog: NetworkLog;
  private activeTabId: string | null = null;
  private activeTabUrl: string | null = null;
  private consoleMessages: Array<{ type: string; text: string; timestamp: number }> = [];
  private maxConsoleMessages = 200;

  private statusListeners: Array<(status: CDPStatus) => void> = [];

  constructor(chromePort: number, reconnectInterval: number, networkLog: NetworkLog, outputChannel: vscode.OutputChannel) {
    this.chromePort = chromePort;
    this.reconnectInterval = reconnectInterval;
    this.networkLog = networkLog;
    this.outputChannel = outputChannel;
  }

  onStatusChange(listener: (status: CDPStatus) => void) {
    this.statusListeners.push(listener);
  }

  private setStatus(status: CDPStatus) {
    this.status = status;
    this.statusListeners.forEach(l => l(status));
  }

  getStatus(): CDPStatus {
    return this.status;
  }

  getActiveTab(): { id: string | null; url: string | null } {
    return { id: this.activeTabId, url: this.activeTabUrl };
  }

  getConsoleMessages(limit = 50) {
    return this.consoleMessages.slice(-limit);
  }

  async connect() {
    if (this.status === 'connecting' || this.status === 'connected') return;
    this.setStatus('connecting');
    this.outputChannel.appendLine('[CDP] Connecting...');

    try {
      const tabs = await this.fetchTabs();
      const tab = tabs.find((t: any) => t.type === 'page' && !t.url.startsWith('chrome-extension://'));
      if (!tab) {
        throw new Error('No usable Chrome tab found');
      }
      this.activeTabId = tab.id;
      this.activeTabUrl = tab.url;

      this.client = await CDP({ port: this.chromePort, target: tab.id });
      await this.enableDomains();
      this.setStatus('connected');
      this.outputChannel.appendLine(`[CDP] Connected to tab: ${tab.url}`);

      this.client.on('disconnect', () => {
        this.outputChannel.appendLine('[CDP] Disconnected');
        this.client = null;
        this.setStatus('disconnected');
        this.scheduleReconnect();
      });
    } catch (err: any) {
      this.outputChannel.appendLine(`[CDP] Connection error: ${err.message}`);
      this.setStatus('error');
      this.scheduleReconnect();
    }
  }

  private async enableDomains() {
    const { Network, Runtime, Page, Console } = this.client;
    await Promise.all([
      Network.enable(),
      Runtime.enable(),
      Page.enable(),
      Console.enable(),
    ]);

    this.client.Network.requestWillBeSent((params: any) => {
      this.networkLog.onRequestWillBeSent(params);
    });
    this.client.Network.responseReceived((params: any) => {
      this.networkLog.onResponseReceived(params);
    });
    this.client.Page.frameNavigated((params: any) => {
      if (params.frame.parentId === undefined) {
        this.activeTabUrl = params.frame.url;
      }
    });
    this.client.Console.messageAdded((params: any) => {
      const msg = {
        type: params.message.level,
        text: params.message.text,
        timestamp: Date.now(),
      };
      if (this.consoleMessages.length >= this.maxConsoleMessages) {
        this.consoleMessages.shift();
      }
      this.consoleMessages.push(msg);
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.connect();
    }, this.reconnectInterval);
  }

  async reconnect() {
    await this.disconnect();
    await this.connect();
  }

  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try { await this.client.close(); } catch {}
      this.client = null;
    }
    this.setStatus('disconnected');
  }

  async fetchTabs(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const req = http.get({ hostname: 'localhost', port: this.chromePort, path: '/json' }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout fetching tabs')); });
    });
  }

  async activateTab(tabId: string): Promise<void> {
    await this.disconnect();
    this.activeTabId = tabId;
    this.client = await CDP({ port: this.chromePort, target: tabId });
    await this.enableDomains();
    this.setStatus('connected');

    const tabs = await this.fetchTabs();
    const tab = tabs.find((t: any) => t.id === tabId);
    if (tab) this.activeTabUrl = tab.url;

    this.client.on('disconnect', () => {
      this.client = null;
      this.setStatus('disconnected');
      this.scheduleReconnect();
    });
  }

  getClient(): any {
    return this.client;
  }
}
