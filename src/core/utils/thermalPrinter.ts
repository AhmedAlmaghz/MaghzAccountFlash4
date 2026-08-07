/**
 * Thermal Printer Integration
 * Supports: ESC/POS commands via Web Serial API or Electron IPC
 */

export interface PrintJob {
  type: 'invoice' | 'receipt' | 'report';
  title?: string;
  lines: PrintLine[];
  qrCode?: string;
  cutPaper?: boolean;
  openDrawer?: boolean;
}

export interface PrintLine {
  text: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  size?: 'normal' | 'wide' | 'tall';
  lineAfter?: boolean;
}

interface SerialPortLike {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  writable: WritableStream;
}

class ThermalPrinter {
  private port: SerialPortLike | null = null;
  private writer: WritableStreamDefaultWriter | null = null;

  async connect(): Promise<boolean> {
    try {
      // Check if Web Serial API is available
      const nav = navigator as Navigator & { serial?: { requestPort: (opts: unknown) => Promise<SerialPortLike> } };
      if ('serial' in navigator && nav.serial) {
        this.port = await nav.serial.requestPort({ filters: [{ usbVendorId: 0x0483 }] } as unknown as { filters: { usbVendorId: number }[] });
        await this.port.open({ baudRate: 9600 });
        this.writer = this.port.writable.getWriter();
        return true;
      }
      
      // Fallback: Check if Electron IPC is available
      const win = window as Window & { electronPrinter?: { connect: () => Promise<boolean>; print: (data: Uint8Array) => Promise<boolean> } };
      if (typeof window !== 'undefined' && win.electronPrinter) {
        return await win.electronPrinter.connect();
      }
      
      return false;
    } catch (_error) {
      return false;
    }
  }

  async disconnect() {
    if (this.writer) {
      this.writer.releaseLock();
      this.writer = null;
    }
    if (this.port) {
      await this.port.close();
      this.port = null;
    }
  }

  async print(job: PrintJob): Promise<boolean> {
    try {
      const commands = this.generateEscPosCommands(job);
      
      if (this.writer) {
        await this.writer.write(commands);
        return true;
      }
      
      // Electron fallback
      const win = window as Window & { electronPrinter?: { connect: () => Promise<boolean>; print: (data: Uint8Array) => Promise<boolean> } };
      if (typeof window !== 'undefined' && win.electronPrinter) {
        return await win.electronPrinter.print(commands);
      }
      
      // Browser fallback: print to default printer
      this.printViaBrowser(job);
      return true;
    } catch (_error) {
      return false;
    }
  }

  private generateEscPosCommands(job: PrintJob): Uint8Array {
    const commands: number[] = [];
    
    // Initialize printer
    commands.push(0x1b, 0x40); // ESC @
    
    // Set Arabic code page (if supported)
    commands.push(0x1b, 0x74, 0x11); // ESC t 17 (Arabic code page)
    
    // Title
    if (job.title) {
      commands.push(0x1b, 0x61, 0x01); // Center align
      commands.push(0x1d, 0x21, 0x11); // Double width & height
      this.addText(commands, job.title);
      commands.push(0x1d, 0x21, 0x00); // Normal size
      commands.push(0x0a); // Line feed
    }
    
    // Lines
    for (const line of job.lines) {
      // Alignment
      const alignCode = line.align === 'center' ? 0x01 : line.align === 'right' ? 0x02 : 0x00;
      commands.push(0x1b, 0x61, alignCode);
      
      // Bold
      if (line.bold) commands.push(0x1b, 0x45, 0x01);
      
      // Size
      if (line.size === 'wide') commands.push(0x1d, 0x21, 0x10);
      else if (line.size === 'tall') commands.push(0x1d, 0x21, 0x01);
      
      this.addText(commands, line.text);
      commands.push(0x0a); // Line feed
      
      // Reset styles
      if (line.bold) commands.push(0x1b, 0x45, 0x00);
      if (line.size !== 'normal') commands.push(0x1d, 0x21, 0x00);
      
      // Line separator
      if (line.lineAfter) {
        commands.push(0x1b, 0x61, 0x00); // Left align
        this.addText(commands, '--------------------------------');
        commands.push(0x0a);
      }
    }
    
    // QR Code
    if (job.qrCode) {
      commands.push(...this.generateQrCode(job.qrCode));
    }
    
    // Cut paper
    if (job.cutPaper) {
      commands.push(0x1d, 0x56, 0x01); // Partial cut
    }
    
    // Open drawer
    if (job.openDrawer) {
      commands.push(0x1b, 0x70, 0x00, 0x19, 0xfa); // Pulse drawer kick
    }
    
    commands.push(0x0a, 0x0a, 0x0a); // Feed lines
    
    return new Uint8Array(commands);
  }

  private addText(commands: number[], text: string) {
    for (let i = 0; i < text.length; i++) {
      commands.push(text.charCodeAt(i));
    }
  }

  private generateQrCode(data: string): number[] {
    const commands: number[] = [];
    const length = data.length + 3;
    const pL = length & 0xff;
    const pH = (length >> 8) & 0xff;
    
    commands.push(0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30);
    this.addText(commands, data);
    commands.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
    
    return commands;
  }

  private printViaBrowser(job: PrintJob) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    const html = `
      <!DOCTYPE html>
      <html dir="rtl">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Cairo', sans-serif; font-size: 12pt; width: 80mm; margin: 0 auto; }
          .center { text-align: center; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .line { border-bottom: 1px dashed #000; margin: 4px 0; }
        </style>
      </head>
      <body>
        ${job.title ? `<h2 class="center bold">${job.title}</h2>` : ''}
        ${job.lines.map(line => `
          <div class="${line.align || 'right'} ${line.bold ? 'bold' : ''}" style="font-size: ${line.size === 'wide' || line.size === 'tall' ? '1.3em' : '1em'}">
            ${line.text}
          </div>
          ${line.lineAfter ? '<div class="line"></div>' : ''}
        `).join('')}
        ${job.qrCode ? `<div class="center"><img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(job.qrCode)}" /></div>` : ''}
        <script>window.onload = () => { window.print(); window.close(); }</script>
      </body>
      </html>
    `;
    
    printWindow.document.write(html);
    printWindow.document.close();
  }
}

export const thermalPrinter = new ThermalPrinter();

export default thermalPrinter;
