/**
 * Barcode Scanner Integration
 * Supports: Barcode Detection API, Keyboard Wedge scanners, Manual input
 */

export interface BarcodeScanResult {
  barcode: string;
  format?: string;
  timestamp: number;
}

type BarcodeCallback = (result: BarcodeScanResult) => void;

class BarcodeScanner {
  private callback: BarcodeCallback | null = null;
  private buffer = '';
  private lastKeyTime = 0;
  private readonly KEYBOARD_WEDGE_THRESHOLD = 50; // ms between keys
  private isListening = false;
  private mediaStream: MediaStream | null = null;

  onScan(callback: BarcodeCallback) {
    this.callback = callback;
    this.startListening();
    return () => this.stopListening();
  }

  private startListening() {
    if (this.isListening) return;
    this.isListening = true;
    
    // Keyboard wedge detection
    document.addEventListener('keydown', this.handleKeyDown);
  }

  private stopListening() {
    this.isListening = false;
    document.removeEventListener('keydown', this.handleKeyDown);
    this.stopCamera();
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    const now = Date.now();
    const timeDiff = now - this.lastKeyTime;
    this.lastKeyTime = now;

    // If Enter is pressed and buffer has content, emit barcode
    if (event.key === 'Enter' && this.buffer.length > 3) {
      event.preventDefault();
      this.emitBarcode(this.buffer);
      this.buffer = '';
      return;
    }

    // Only accept printable characters
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // Fast typing = keyboard wedge scanner
      if (timeDiff < this.KEYBOARD_WEDGE_THRESHOLD || this.buffer.length > 0) {
        this.buffer += event.key;
      } else {
        this.buffer = event.key;
      }
    }
  };

  private emitBarcode(barcode: string) {
    if (this.callback) {
      this.callback({
        barcode: barcode.trim(),
        timestamp: Date.now(),
      });
    }
  }

  // Camera-based scanning using Barcode Detection API
  async startCameraScan(videoElement: HTMLVideoElement, callback: BarcodeCallback): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      this.mediaStream = stream;
      videoElement.srcObject = stream;
      await videoElement.play();

      // Check if Barcode Detection API is available
      if ('BarcodeDetector' in window) {
        interface BarcodeDetectorCtor { new(opts: { formats: string[] }): { detect(video: HTMLVideoElement): Promise<Array<{ rawValue: string; format: string }>> } }
        const DetectorCtor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
        const detector = new DetectorCtor({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'qr_code'] });
        
        const scanFrame = async () => {
          if (!this.mediaStream || videoElement.paused) return;
          try {
            const barcodes = await detector.detect(videoElement);
            if (barcodes.length > 0) {
              callback({
                barcode: barcodes[0].rawValue,
                format: barcodes[0].format,
                timestamp: Date.now(),
              });
            }
          } catch {
            // Ignore detection errors
          }
          requestAnimationFrame(scanFrame);
        };
        
        requestAnimationFrame(scanFrame);
        return true;
      }
      
      return false;
    } catch (_error) {
      return false;
    }
  }

  stopCamera() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
  }

  // Manual input
  scanManual(barcode: string) {
    this.emitBarcode(barcode);
  }
}

export const barcodeScanner = new BarcodeScanner();

export default barcodeScanner;
