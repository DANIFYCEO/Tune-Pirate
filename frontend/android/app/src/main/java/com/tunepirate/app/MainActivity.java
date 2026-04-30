package com.tunepirate.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onPause() {
        super.onPause();
        // Keep WebView audio playing in background
        WebView webView = this.bridge.getWebView();
        if (webView != null) {
            // Force resume right after Capacitor pauses it
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
    }
}
