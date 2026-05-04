package com.tunepirate.app;

import android.os.Bundle;
import android.os.PowerManager;
import android.content.Context;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private PowerManager.WakeLock wakeLock;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Acquire a partial wake lock so the CPU keeps running when screen is off
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "TunePirate::AudioWakeLock"
            );
        }
    }

    @Override
    public void onPause() {
        super.onPause();

        // Prevent WebView from pausing JS execution and audio when app backgrounds
        WebView webView = this.bridge.getWebView();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
        }

        // Acquire wake lock to keep CPU alive (audio keeps playing)
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(4 * 60 * 60 * 1000L); // max 4 hours
        }
    }

    @Override
    public void onResume() {
        super.onResume();

        // Release wake lock when app comes back to foreground
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }

        // Ensure WebView timers are running
        WebView webView = this.bridge.getWebView();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    public void onDestroy() {
        // Clean up wake lock
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        super.onDestroy();
    }
}
