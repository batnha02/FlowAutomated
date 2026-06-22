import { exec } from 'child_process';
import { promisify } from 'util';
import { Server } from 'socket.io';
import { Step } from './types';

const execAsync = promisify(exec);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class WorkflowExecutor {
  private cancelled = false;
  private browser: any = null;
  private page: any = null;

  cancel() {
    this.cancelled = true;
  }

  async execute(steps: Step[], io: Server, socketId: string) {
    this.cancelled = false;
    const emit = (event: string, data: unknown) => io.to(socketId).emit(event, data);

    emit('execution:start', { total: steps.length });

    try {
      for (let i = 0; i < steps.length; i++) {
        if (this.cancelled) {
          emit('execution:cancelled', { stoppedAt: i });
          return;
        }

        const step = steps[i];
        emit('execution:step', { index: i, status: 'running' });
        emit('execution:log', { message: `[${i + 1}/${steps.length}] Running: ${step.name}` });

        try {
          await this.runStep(step, emit);
          emit('execution:step', { index: i, status: 'done' });
          emit('execution:log', { message: `✓ Step ${i + 1} completed` });

          const delay = step.delay ?? 0;
          if (delay > 0 && !this.cancelled) {
            emit('execution:log', { message: `  Waiting ${delay}ms...` });
            await sleep(delay);
          }
        } catch (err: any) {
          emit('execution:step', { index: i, status: 'failed', error: err.message });
          emit('execution:log', { message: `✗ Step ${i + 1} failed: ${err.message}` });
          emit('execution:error', { stepIndex: i, error: err.message });
          return;
        }
      }
      emit('execution:done', { total: steps.length });
      emit('execution:log', { message: `All ${steps.length} steps completed successfully.` });
    } finally {
      await this.closeBrowser();
    }
  }

  private async runStep(step: Step, emit: (e: string, d: unknown) => void) {
    const os = process.platform;

    switch (step.actionType) {
      case 'left_click':
        await this.executeClick(step.target, 1, os);
        break;
      case 'right_click':
        await this.executeClick(step.target, 3, os);
        break;
      case 'double_click':
        await this.executeDoubleClick(step.target, os);
        break;
      case 'keyboard_input':
        await this.executeKeyboardInput(step.target, step.value, os);
        break;
      case 'open_app':
        await this.executeOpenApp(step.target, os);
        break;
      case 'browser_click':
        await this.ensureBrowser(emit);
        await this.page.click(step.target);
        break;
      case 'browser_type':
        await this.ensureBrowser(emit);
        await this.page.fill(step.target ?? '', step.value ?? '');
        break;
      case 'browser_navigate':
        await this.ensureBrowser(emit);
        await this.page.goto(step.target ?? '');
        emit('execution:log', { message: `  Navigated to ${step.target}` });
        break;
      case 'browser_wait':
        await this.ensureBrowser(emit);
        await this.page.waitForSelector(step.target ?? '', {
          timeout: parseInt(step.value ?? '5000')
        });
        break;
      case 'browser_screenshot':
        await this.ensureBrowser(emit);
        await this.page.screenshot({ path: step.target || 'screenshot.png', fullPage: true });
        emit('execution:log', { message: `  Screenshot saved to ${step.target || 'screenshot.png'}` });
        break;
      case 'delay':
        await sleep(parseInt(step.value ?? '1000'));
        break;
      default:
        throw new Error(`Unknown action type: ${(step as any).actionType}`);
    }
  }

  private async executeClick(target: string | undefined, button: number, os: string) {
    if (!target) throw new Error('Target (x,y coordinates) required for click');
    const [x, y] = this.parseCoords(target);
    if (os === 'linux') {
      await execAsync(`xdotool mousemove ${x} ${y} click ${button}`);
    } else if (os === 'win32') {
      const ps = `
Add-Type @"
using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
}
"@
[Mouse]::SetCursorPos(${x},${y});
[Mouse]::mouse_event(${button === 1 ? 2 : 8},0,0,0,0);
[Mouse]::mouse_event(${button === 1 ? 4 : 16},0,0,0,0)`.trim();
      await execAsync(`powershell -NoProfile -Command "${ps.replace(/\n/g, ';')}"`);
    } else {
      throw new Error(`Click automation not supported on ${os}`);
    }
  }

  private async executeDoubleClick(target: string | undefined, os: string) {
    if (!target) throw new Error('Target (x,y coordinates) required for double click');
    const [x, y] = this.parseCoords(target);
    if (os === 'linux') {
      await execAsync(`xdotool mousemove ${x} ${y} click --repeat 2 --delay 100 1`);
    } else if (os === 'win32') {
      await this.executeClick(target, 1, os);
      await sleep(100);
      await this.executeClick(target, 1, os);
    } else {
      throw new Error(`Double click not supported on ${os}`);
    }
  }

  private async executeKeyboardInput(windowTitle: string | undefined, text: string | undefined, os: string) {
    if (!text) throw new Error('Value (text to type) required for keyboard_input');
    if (os === 'linux') {
      if (windowTitle) {
        await execAsync(`xdotool search --name "${windowTitle}" windowfocus --sync`).catch(() => {});
        await sleep(150);
      }
      const escaped = text.replace(/'/g, "'\\''");
      await execAsync(`xdotool type --delay 30 '${escaped}'`);
    } else if (os === 'win32') {
      if (windowTitle) {
        const focus = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate('${windowTitle}')`;
        await execAsync(`powershell -NoProfile -Command "${focus}"`).catch(() => {});
        await sleep(150);
      }
      const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')`;
      await execAsync(`powershell -NoProfile -Command "${ps}"`);
    } else {
      throw new Error(`Keyboard input not supported on ${os}`);
    }
  }

  private async executeOpenApp(target: string | undefined, os: string) {
    if (!target) throw new Error('Target (app path/command) required for open_app');
    if (os === 'linux') {
      exec(`${target} &`);
    } else if (os === 'win32') {
      exec(`start "" "${target}"`);
    } else {
      exec(`open "${target}"`);
    }
    await sleep(500);
  }

  private async ensureBrowser(emit: (e: string, d: unknown) => void) {
    if (this.browser) return;
    let playwright: any;
    try {
      playwright = await import('playwright');
    } catch {
      throw new Error('Playwright not installed. Run: cd backend && npm install playwright && npx playwright install chromium');
    }
    emit('execution:log', { message: '  Launching browser...' });
    this.browser = await playwright.chromium.launch({ headless: false });
    const context = await this.browser.newContext();
    this.page = await context.newPage();
    emit('execution:log', { message: '  Browser ready.' });
  }

  private async closeBrowser() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page = null;
    }
  }

  private parseCoords(target: string): [number, number] {
    const parts = target.split(',').map(s => parseInt(s.trim()));
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
      throw new Error(`Invalid coordinates "${target}". Expected format: x,y (e.g. 100,200)`);
    }
    return [parts[0], parts[1]];
  }
}
