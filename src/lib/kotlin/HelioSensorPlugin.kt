package com.helioforge.solar

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.Surface
import android.view.WindowManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * HELIO-FORGE — HelioSensorPlugin.kt
 * ============================================================================
 * Native Android Capacitor bridge. Exposes two hardware pipelines to the
 * Svelte 5 workstation running inside the WebView:
 *
 *  1. Sensor fusion  — Sensor.TYPE_ROTATION_VECTOR (game-rotation vector) fused
 *     with Sensor.TYPE_MAGNETIC_FIELD for a drift-compensated true heading,
 *     plus pitch/roll for the panel tilt clinometer.
 *
 *  2. Battery telemetry — BatteryManager EXTRA_VOLTAGE, EXTRA_TEMPERATURE and
 *     EXTRA_PLUGGED/EXTRA_STATUS, sampled on a background dispatcher and
 *     pushed to JS at a configurable rate.
 *
 * Events emitted to the web layer:
 *   "sensorFusion"     { azimuth, pitch, roll, accuracy, source, timestamp }
 *   "batteryTelemetry" { percent, voltage, temperatureC, chargeCurrentMa,
 *                        charging, plugged, health, timestamp }
 *
 * All listener lifecycles are bound to the plugin so the WebView never leaks
 * a registered sensor when the app is backgrounded.
 */
@CapacitorPlugin(name = "HelioSensor")
class HelioSensorPlugin : Plugin(), SensorEventListener {

    companion object {
        private const val TAG = "HelioSensor"
        private const val NS_TO_MS = 1_000_000.0
        private const val RAD_TO_DEG = 180.0 / Math.PI
        private const val DEFAULT_RATE_HZ = 30
    }

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val mainHandler = Handler(Looper.getMainLooper())

    private var sensorManager: SensorManager? = null
    private var rotationSensor: Sensor? = null
    private var magneticSensor: Sensor? = null
    private var accelerometer: Sensor? = null

    // Fused state
    private val rotationMatrix = FloatArray(9)
    private val orientation = FloatArray(3)
    private val gravity = FloatArray(3)
    private val geomagnetic = FloatArray(3)
    private val remappedMatrix = FloatArray(9)
    private var rotationAccuracy = 0
    private var lastEmitMs = 0L
    private var emitIntervalMs = (1000L / DEFAULT_RATE_HZ)
    private var streaming = false

    // Magnetic declination: JS can push the WMM value for true-north correction
    private var declinationDeg = 0.0

    private var batteryReceiver: BroadcastReceiver? = null
    private var batteryStreaming = false

    // ------------------------------------------------------------------ setup

    override fun load() {
        sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        sensorManager?.let { sm ->
            rotationSensor = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
                ?: sm.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
            magneticSensor = sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)
            accelerometer = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        }
    }

    override fun handleOnDestroy() {
        stopFusionInternal()
        stopBatteryInternal()
        scope.cancel()
        super.handleOnDestroy()
    }

    // ------------------------------------------------------------ JS methods

    /**
     * Start the fused orientation pipeline.
     * call: { rateHz?: number, declinationDeg?: number }
     */
    @PluginMethod
    fun startFusion(call: PluginCall) {
        if (streaming) {
            call.resolve(JSObject().apply { put("streaming", true) })
            return
        }
        val sm = sensorManager
        if (sm == null || rotationSensor == null) {
            call.reject("Rotation vector sensor unavailable on this device")
            return
        }

        val rateHz = call.getInt("rateHz") ?: DEFAULT_RATE_HZ
        emitIntervalMs = (1000L / rateHz.coerceIn(1, 120))
        declinationDeg = call.getDouble("declinationDeg") ?: 0.0

        val period = when {
            rateHz >= 60 -> SensorManager.SENSOR_DELAY_FASTEST
            rateHz >= 30 -> SensorManager.SENSOR_DELAY_GAME
            rateHz >= 10 -> SensorManager.SENSOR_DELAY_UI
            else -> SensorManager.SENSOR_DELAY_NORMAL
        }

        sm.registerListener(this, rotationSensor, period, mainHandler)
        accelerometer?.let { sm.registerListener(this, it, period, mainHandler) }
        magneticSensor?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_UI, mainHandler) }

        streaming = true
        call.resolve(
            JSObject().apply {
                put("streaming", true)
                put("rateHz", rateHz)
                put("sensor", rotationSensor?.name ?: "rotation_vector")
                put("magnetometer", magneticSensor != null)
                put("accelerometer", accelerometer != null)
            }
        )
    }

    @PluginMethod
    fun stopFusion(call: PluginCall) {
        stopFusionInternal()
        call.resolve(JSObject().apply { put("streaming", false) })
    }

    /** { declinationDeg: number } — magnetic -> true north correction. */
    @PluginMethod
    fun setDeclination(call: PluginCall) {
        declinationDeg = call.getDouble("declinationDeg") ?: 0.0
        call.resolve(JSObject().apply { put("declinationDeg", declinationDeg) })
    }

    /** One-shot battery read. */
    @PluginMethod
    fun getBatteryTelemetry(call: PluginCall) {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        call.resolve(intent?.let { batteryPayload(it) } ?: JSObject())
    }

    /** { intervalMs?: number } — push battery telemetry at a steady cadence. */
    @PluginMethod
    fun startBatteryStream(call: PluginCall) {
        if (batteryStreaming) {
            call.resolve(JSObject().apply { put("streaming", true) })
            return
        }
        // Seed the JS side immediately so the UI never renders an empty card.
        context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?.let { notifyListeners("batteryTelemetry", batteryPayload(it), true) }

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                intent?.let { notifyListeners("batteryTelemetry", batteryPayload(it), true) }
            }
        }
        context.registerReceiver(receiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        batteryReceiver = receiver
        batteryStreaming = true
        call.resolve(JSObject().apply { put("streaming", true) })
    }

    @PluginMethod
    fun stopBatteryStream(call: PluginCall) {
        stopBatteryInternal()
        call.resolve(JSObject().apply { put("streaming", false) })
    }

    /**
     * Haptic confirmation used by the ±0.5° tilt lock-on.
     * call: { pattern?: number[], strength?: "light" | "medium" | "heavy" }
     */
    @PluginMethod
    fun hapticLock(call: PluginCall) {
        val pattern = call.getArray("pattern")?.toList()?.mapNotNull { (it as? Number)?.toLong() }?.toLongArray()
            ?: longArrayOf(18, 50, 18)
        vibrate(pattern)
        call.resolve(JSObject().apply { put("vibrated", true) })
    }

    @Suppress("DEPRECATION")
    private fun vibrate(pattern: LongArray) {
        val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vm?.defaultVibrator
        } else {
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
        if (vibrator == null || !vibrator.hasVibrator()) return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            vibrator.vibrate(pattern, -1)
        }
    }

    // -------------------------------------------------------- sensor callbacks

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_ROTATION_VECTOR,
            Sensor.TYPE_GAME_ROTATION_VECTOR -> {
                SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
                rotationAccuracy = event.accuracy
                emitFusion()
            }

            Sensor.TYPE_ACCELEROMETER -> {
                lowPass(event.values, gravity)
            }

            Sensor.TYPE_MAGNETIC_FIELD -> {
                lowPass(event.values, geomagnetic)
                // Fallback fusion when no rotation vector is present on the device
                if (rotationSensor == null) {
                    val r = FloatArray(9)
                    if (SensorManager.getRotationMatrix(r, null, gravity, geomagnetic)) {
                        r.copyInto(rotationMatrix)
                        emitFusion()
                    }
                }
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        if (sensor?.type == Sensor.TYPE_ROTATION_VECTOR) rotationAccuracy = accuracy
    }

    private fun emitFusion() {
        val now = System.currentTimeMillis()
        if (now - lastEmitMs < emitIntervalMs) return
        lastEmitMs = now

        // Remap for the current display rotation so portrait/landscape both read
        // "tilt away from the user" correctly.
        val rotation = currentDisplayRotation()
        val (axisX, axisY) = when (rotation) {
            Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
            Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
            Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
            else -> SensorManager.AXIS_X to SensorManager.AXIS_Y
        }
        SensorManager.remapCoordinateSystem(rotationMatrix, axisX, axisY, remappedMatrix)
        SensorManager.getOrientation(remappedMatrix, orientation)

        val rawAzimuth = normalize360(orientation[0] * RAD_TO_DEG)
        val trueAzimuth = normalize360(rawAzimuth + declinationDeg)

        // pitch: the angle of the device plane off horizontal (clinometer tilt)
        val pitchDeg = -orientation[1] * RAD_TO_DEG
        val rollDeg = orientation[2] * RAD_TO_DEG

        // Panel tilt: when the phone lies flat on a panel, |pitch| approaches 90
        // minus the panel tilt. Report both so JS can choose.
        val panelTilt = (90.0 - abs(pitchDeg)).coerceIn(0.0, 90.0)

        val payload = JSObject().apply {
            put("azimuth", round2(trueAzimuth))
            put("magneticAzimuth", round2(rawAzimuth))
            put("declination", declinationDeg)
            put("pitch", round2(pitchDeg))
            put("roll", round2(rollDeg))
            put("panelTilt", round2(panelTilt))
            put("accuracy", accuracyLabel(rotationAccuracy))
            put("source", if (rotationSensor?.type == Sensor.TYPE_ROTATION_VECTOR) "rotation_vector" else "magnetometer_fusion")
            put("timestamp", now)
        }
        notifyListeners("sensorFusion", payload, true)
    }

    // -------------------------------------------------------- battery payload

    private fun batteryPayload(intent: Intent): JSObject {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        val percent = if (level >= 0 && scale > 0) (level * 100f / scale).roundToInt() else -1

        val voltageMv = intent.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0)
        val tempTenths = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
        val health = intent.getIntExtra(BatteryManager.EXTRA_HEALTH, -1)

        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL ||
            plugged != 0

        // BatteryManager reports instantaneous current in microamps (negative
        // while discharging) on API 21+.
        val currentUa = try {
            bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW) ?: 0
        } catch (_: Throwable) {
            0
        }

        return JSObject().apply {
            put("percent", percent)
            put("voltage", voltageMv / 1000.0)
            put("temperatureC", tempTenths / 10.0)
            put("chargeCurrentMa", currentUa / 1000.0)
            put("charging", charging)
            put("plugged", pluggedLabel(plugged))
            put("health", healthLabel(health))
            put("technology", intent.getStringExtra(BatteryManager.EXTRA_TECHNOLOGY) ?: "unknown")
            put("timestamp", System.currentTimeMillis())
        }
    }

    // --------------------------------------------------------------- helpers

    private fun stopFusionInternal() {
        sensorManager?.unregisterListener(this)
        streaming = false
    }

    private fun stopBatteryInternal() {
        batteryReceiver?.let {
            runCatching { context.unregisterReceiver(it) }
        }
        batteryReceiver = null
        batteryStreaming = false
    }

    private fun currentDisplayRotation(): Int {
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        return wm?.defaultDisplay?.rotation ?: Surface.ROTATION_0
    }

    private fun lowPass(input: FloatArray, output: FloatArray, alpha: Float = 0.12f) {
        if (output.all { it == 0f }) {
            input.copyInto(output, 0, 0, minOf(input.size, output.size))
            return
        }
        for (i in output.indices) {
            output[i] = output[i] + alpha * (input[i] - output[i])
        }
    }

    private fun normalize360(deg: Double): Double {
        val d = deg % 360.0
        return if (d < 0) d + 360.0 else d
    }

    private fun round2(value: Double): Double = (value * 100.0).roundToInt() / 100.0

    private fun accuracyLabel(accuracy: Int): String = when (accuracy) {
        SensorManager.SENSOR_STATUS_ACCURACY_HIGH -> "high"
        SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM -> "medium"
        SensorManager.SENSOR_STATUS_ACCURACY_LOW -> "low"
        SensorManager.SENSOR_STATUS_UNRELIABLE -> "unreliable"
        else -> "unknown"
    }

    private fun pluggedLabel(plugged: Int): String = when (plugged) {
        BatteryManager.BATTERY_PLUGGED_AC -> "ac"
        BatteryManager.BATTERY_PLUGGED_USB -> "usb"
        BatteryManager.BATTERY_PLUGGED_WIRELESS -> "wireless"
        else -> "unplugged"
    }

    private fun healthLabel(health: Int): String = when (health) {
        BatteryManager.BATTERY_HEALTH_GOOD -> "good"
        BatteryManager.BATTERY_HEALTH_OVERHEAT -> "overheat"
        BatteryManager.BATTERY_HEALTH_DEAD -> "dead"
        BatteryManager.BATTERY_HEALTH_COLD -> "cold"
        BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "over_voltage"
        BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> "failure"
        else -> "unknown"
    }
}
