package com.maghzaccount.aierp;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * WebView shell that displays the deployed web application (Vercel).
 *
 * - JavaScript + DOM storage enabled: the web app persists data in the
 *   browser (PGlite / IndexedDB), so storage MUST survive inside the shell.
 * - The app domain stays inside the shell; external links open in the
 *   system browser.
 * - File chooser support: the ERP allows uploading attachments / photos.
 * - Camera / microphone are requested at runtime: the WebView never prompts by
 *   itself, the host must hold the OS permission and grant the page request
 *   (POS barcode scanner, AI camera capture, voice dictation).
 * - Back button navigates the WebView history first.
 */
public class MainActivity extends Activity {

    private static final String START_URL = BuildConfig.WEBAPP_URL;
    private static final String APP_HOST = Uri.parse(START_URL).getHost();
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int MEDIA_PERMISSION_REQUEST = 1002;

    private WebView webView;
    private ProgressBar progressBar;
    private ValueCallback<Uri[]> filePathCallback;
    /** Page request (camera / microphone) waiting for the OS permission dialog. */
    private PermissionRequest pendingPermissionRequest;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.getProgressDrawable().setColorFilter(
                0xFF0B7A5E, android.graphics.PorterDuff.Mode.SRC_IN);
        root.addView(progressBar, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP));

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setBackgroundColor(Color.WHITE);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (host != null && (host.equals(APP_HOST) || host.equals("www." + APP_HOST))) {
                    return false; // keep the app domain inside the shell
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(MainActivity.this, R.string.cannot_open_link, Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    return false;
                }
            }

            /**
             * Camera / microphone access requested by the page (POS barcode
             * scanner, AI camera capture, voice dictation). WebView never shows
             * an OS prompt on its own: the app must hold the runtime permission
             * and grant the page request, otherwise getUserMedia() fails with
             * NotAllowedError even though the manifest declares the permission.
             */
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (!isTrustedOrigin(request.getOrigin())) {
                    request.deny();
                    return;
                }
                String[] needed = runtimePermissionsFor(request);
                if (needed.length == 0) {
                    request.deny(); // e.g. protected media / MIDI: not used by the app
                    return;
                }
                if (hasAllPermissions(needed)) {
                    request.grant(request.getResources());
                    return;
                }
                if (pendingPermissionRequest != null) {
                    request.deny(); // one OS dialog at a time
                    return;
                }
                pendingPermissionRequest = request;
                requestPermissions(needed, MEDIA_PERMISSION_REQUEST);
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingPermissionRequest == request) {
                    pendingPermissionRequest = null;
                }
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }

        setContentView(root);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && filePathCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{ data.getData() };
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != MEDIA_PERMISSION_REQUEST) {
            super.onRequestPermissionsResult(requestCode, permissions, grantResults);
            return;
        }
        PermissionRequest pending = pendingPermissionRequest;
        pendingPermissionRequest = null;
        if (pending == null) {
            return;
        }
        if (grantResults.length > 0 && allGranted(grantResults)) {
            pending.grant(pending.getResources());
        } else {
            pending.deny();
            Toast.makeText(this, R.string.permission_denied_media, Toast.LENGTH_LONG).show();
        }
    }

    /** OS runtime permissions required for the resources the page asked for. */
    private static String[] runtimePermissionsFor(PermissionRequest request) {
        List<String> wanted = new ArrayList<>(2);
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                if (!wanted.contains(Manifest.permission.CAMERA)) {
                    wanted.add(Manifest.permission.CAMERA);
                }
            } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                if (!wanted.contains(Manifest.permission.RECORD_AUDIO)) {
                    wanted.add(Manifest.permission.RECORD_AUDIO);
                }
            }
        }
        return wanted.toArray(new String[0]);
    }

    private boolean hasAllPermissions(String[] permissions) {
        for (String permission : permissions) {
            if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    private static boolean allGranted(int[] grantResults) {
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    /** Only the deployed app origin (HTTPS) may use the camera / microphone. */
    private static boolean isTrustedOrigin(Uri origin) {
        if (origin == null) {
            return false;
        }
        String scheme = origin.getScheme();
        String host = origin.getHost();
        if (scheme == null || host == null || !scheme.equals("https")) {
            return false;
        }
        return host.equals(APP_HOST) || host.equals("www." + APP_HOST);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onDestroy() {
        // The WebView (and any page request it was waiting on) is going away.
        pendingPermissionRequest = null;
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}