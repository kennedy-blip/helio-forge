package com.helioforge.solar

import android.os.Bundle
import android.view.WindowManager
import com.getcapacitor.BridgeActivity

/**
 * HELIO-FORGE — MainActivity.kt
 * Edge-to-edge WebView host that registers the native sensor bridge before the
 * Capacitor bridge is created (the plugin must exist before plugins load).
 */
class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(HelioSensorPlugin::class.java)
        super.onCreate(savedInstanceState)

        // Field use: keep the screen awake while aligning panels on a roof.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
