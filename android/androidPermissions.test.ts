import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Android shell gate.
 *
 * The Android app is a thin WebView shell (android/app/src/main) whose runtime
 * capabilities come from the web bundle it loads. Two failure modes are silent
 * in a normal build and only show up on a device:
 *
 * 1. The web app calls getUserMedia() for the POS barcode scanner, the AI
 *    camera capture and voice dictation, but the manifest does not declare
 *    CAMERA / RECORD_AUDIO -> every capture fails with NotAllowedError.
 * 2. The manifest declares the permissions, but the shell never implements
 *    WebChromeClient.onPermissionRequest -> Android WebView does NOT prompt by
 *    itself, so the page request is denied no matter what the manifest says.
 *
 * This gate reads the manifest, the shell source and the web call sites as text
 * and pins the contract between them.
 */
const root = resolve(__dirname, '..');
const manifest = readFileSync(resolve(root, 'android/app/src/main/AndroidManifest.xml'), 'utf-8');
const mainActivity = readFileSync(
  resolve(root, 'android/app/src/main/java/com/maghzaccount/aierp/MainActivity.java'),
  'utf-8',
);
const strings = readFileSync(resolve(root, 'android/app/src/main/res/values/strings.xml'), 'utf-8');

const declaredPermissions = [...manifest.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map(
  (m) => m[1],
);

describe('Android shell permissions (manifest ↔ MainActivity ↔ web bundle)', () => {
  it('declares the network permission the shell loads the ERP with', () => {
    expect(declaredPermissions).toContain('android.permission.INTERNET');
  });

  it('declares camera + microphone because the web bundle calls getUserMedia()', () => {
    const getUserMediaCallSites = [
      'src/core/utils/barcodeScanner.ts', // POS barcode scanner
      'src/modules/ai/components/CameraCapture.tsx', // AI camera capture
      'src/modules/ai/voice/audioConstraints.ts', // voice notes / dictation
    ];
    for (const rel of getUserMediaCallSites) {
      expect(readFileSync(resolve(root, rel), 'utf-8')).toContain('getUserMedia');
    }
    expect(declaredPermissions).toContain('android.permission.CAMERA');
    expect(declaredPermissions).toContain('android.permission.RECORD_AUDIO');
  });

  it('keeps camera / microphone as optional hardware features', () => {
    // Declaring the permissions would otherwise make the store listing REQUIRE
    // camera + mic and hide the app from tablets / POS terminals without them.
    for (const feature of [
      'android.hardware.camera',
      'android.hardware.camera.any',
      'android.hardware.camera.autofocus',
      'android.hardware.microphone',
    ]) {
      expect(manifest).toContain(
        `<uses-feature android:name="${feature}" android:required="false" />`,
      );
    }
  });

  it('asks the OS for every runtime permission the shell may request', () => {
    // WebView hands the page request to onPermissionRequest; the host must hold
    // the OS permission before it can grant it.
    expect(mainActivity).toContain('public void onPermissionRequest(PermissionRequest request)');
    expect(mainActivity).toContain('requestPermissions(needed, MEDIA_PERMISSION_REQUEST)');
    expect(mainActivity).toContain('PermissionRequest.RESOURCE_VIDEO_CAPTURE');
    expect(mainActivity).toContain('PermissionRequest.RESOURCE_AUDIO_CAPTURE');
  });

  it('requests only permissions that are declared in the manifest', () => {
    const requested = [
      ...mainActivity.matchAll(/Manifest\.permission\.([A-Z_]+)/g),
    ].map((m) => m[1]);
    expect(requested.length).toBeGreaterThan(0);
    for (const name of requested) {
      expect(declaredPermissions).toContain(`android.permission.${name}`);
    }
  });

  it('grants camera / microphone to the app origin only', () => {
    expect(mainActivity).toContain('isTrustedOrigin(request.getOrigin())');
    expect(mainActivity).toContain('scheme.equals("https")');
  });

  it('has the string resource shown when the user denies the request', () => {
    expect(mainActivity).toContain('R.string.permission_denied_media');
    expect(strings).toContain('name="permission_denied_media"');
  });
});
