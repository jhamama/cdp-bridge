import express from 'express';
import cors from 'cors';
import * as http from 'http';
import * as vscode from 'vscode';
import { CDPManager } from './cdp';

export class BridgeServer {
  private app: express.Application;
  private server: http.Server | null = null;
  private port: number;
  private cdp: CDPManager;
  private outputChannel: vscode.OutputChannel;

  constructor(port: number, cdp: CDPManager, outputChannel: vscode.OutputChannel) {
    this.port = port;
    this.cdp = cdp;
    this.outputChannel = outputChannel;
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use((req, _res, next) => {
      this.outputChannel.appendLine(`[HTTP] ${req.method} ${req.path}`);
      next();
    });
    this.registerRoutes();
  }

  private ok(res: express.Response, data: any) {
    res.json({ ok: true, data });
  }

  private err(res: express.Response, message: string, status = 400) {
    res.status(status).json({ ok: false, error: message });
  }

  private requireCDP(res: express.Response): boolean {
    if (!this.cdp.getClient()) {
      this.err(res, 'CDP not connected', 503);
      return false;
    }
    return true;
  }

  private registerRoutes() {
    const r = this.app;

    // GET /status
    r.get('/status', (_req, res) => {
      const tab = this.cdp.getActiveTab();
      this.ok(res, {
        cdpStatus: this.cdp.getStatus(),
        serverPort: this.port,
        activeTab: tab,
      });
    });

    // GET /tabs
    r.get('/tabs', async (_req, res) => {
      try {
        const tabs = await this.cdp.fetchTabs();
        this.ok(res, tabs.map((t: any) => ({ id: t.id, url: t.url, title: t.title, type: t.type })));
      } catch (e: any) {
        this.err(res, e.message, 503);
      }
    });

    // POST /tabs/:id/activate
    r.post('/tabs/:id/activate', async (req, res) => {
      try {
        await this.cdp.activateTab(req.params.id);
        this.ok(res, { activated: req.params.id });
      } catch (e: any) {
        this.err(res, e.message);
      }
    });

    // POST /navigate
    r.post('/navigate', async (req, res) => {
      if (!this.requireCDP(res)) return;
      const { url } = req.body;
      if (!url) return this.err(res, 'url required');
      try {
        await this.cdp.getClient().Page.navigate({ url });
        this.ok(res, { url });
      } catch (e: any) {
        this.err(res, e.message);
      }
    });

    // POST /eval
    r.post('/eval', async (req, res) => {
      if (!this.requireCDP(res)) return;
      const { expression } = req.body;
      if (!expression) return this.err(res, 'expression required');
      try {
        const result = await this.cdp.getClient().Runtime.evaluate({
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (result.exceptionDetails) {
          return this.ok(res, { error: result.exceptionDetails.text || 'JS exception', type: 'exception' });
        }
        this.ok(res, { result: result.result.value, type: result.result.type });
      } catch (e: any) {
        this.err(res, e.message);
      }
    });

    // POST /click
    r.post('/click', async (req, res) => {
      if (!this.requireCDP(res)) return;
      const { selector } = req.body;
      if (!selector) return this.err(res, 'selector required');
      try {
        const result = await this.cdp.getClient().Runtime.evaluate({
          expression: `
            (function() {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return { found: false };
              el.click();
              return { found: true };
            })()
          `,
          returnByValue: true,
        });
        if (result.exceptionDetails) return this.err(res, result.exceptionDetails.text);
        this.ok(res, result.result.value);
      } catch (e: any) {
        this.err(res, e.message);
      }
    });

    // POST /type
    r.post('/type', async (req, res) => {
      if (!this.requireCDP(res)) return;
      const { selector, text } = req.body;
      if (!selector || text === undefined) return this.err(res, 'selector and text required');
      try {
        const focusResult = await this.cdp.getClient().Runtime.evaluate({
          expression: `
            (function() {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return false;
              el.focus();
              return true;
            })()
          `,
          returnByValue: true,
        });
        if (!focusResult.result.value) return this.err(res, 'Element not found');
        const Input = this.cdp.getClient().Input;
        for (const char of text) {
          await Input.dispatchKeyEvent({ type: 'char', text: char });
        }
        this.ok(res, { typed: text.length });
      } catch (e: any) {
        this.err(res, e.message);
      }
    });

    // POST /scroll
    r.post('/scroll', async (req, res) => {
      if (!this.requireCDP(res)) return;
      const { x = 0, y = 0, deltaX = 0, deltaY = 0, selector } = req.body;
      try {
        if (selector) {
          await this.cdp.getClient().Runtime.evaluate({
            expression: `
              (function() {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (el) el.scrollBy(${deltaX}, ${deltaY});
              })()
            `,
          });
        } else {
          await this.cdp.getClient().Input.dispatchMouseEvent({
            type: 'mouseWheel',
            x,
            y,
            deltaX,
            deltaY,
          });
        }
        this.ok(res, { scrolled: true });
      } catch (e: any) {
        this.err(res, e.message);
      }
    });

    // GET /screenshot
    r.get('/screenshot', async (_req, res) => {
      if (!this.requireCDP(res)) return;
      try {
        const result = await this.cdp.getClient().Page.captureScreenshot({ format: 'png' });
        this.ok(res, { data: result.data, mimeType: 'image/png' });
      } catch (e: any) {
        this.err(res, e.message);
      }
    });

    // GET /network
    r.get('/network', (req, res) => {
      const limit = parseInt(req.query.limit as string) || 50;
      const filter = req.query.filter as string | undefined;
      const method = req.query.method as string | undefined;
      this.ok(res, this.cdp.networkLog.get(limit, filter, method));
    });

    // POST /network/clear
    r.post('/network/clear', (_req, res) => {
      this.cdp.networkLog.clear();
      this.ok(res, { cleared: true });
    });

    // GET /console
    r.get('/console', (req, res) => {
      const limit = parseInt(req.query.limit as string) || 50;
      this.ok(res, this.cdp.getConsoleMessages(limit));
    });

    // GET /dom
    r.get('/dom', async (_req, res) => {
      if (!this.requireCDP(res)) return;
      try {
        const result = await this.cdp.getClient().Runtime.evaluate({
          expression: 'document.documentElement.outerHTML',
          returnByValue: true,
        });
        this.ok(res, { html: result.result.value });
      } catch (e: any) {
        this.err(res, e.message);
      }
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, '127.0.0.1', () => {
        this.outputChannel.appendLine(`[Server] Listening on localhost:${this.port}`);
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => {
        this.server = null;
        this.outputChannel.appendLine('[Server] Stopped');
        resolve();
      });
    });
  }
}
