# HELIO-FORGE — release ProGuard rules.
#
# minifyEnabled is false in app/build.gradle, so this file is currently only
# referenced by proguardFiles, not applied. It exists so the release build does
# not fail on a missing proguardFiles target, and so enabling shrinking later is
# a one-line change.

# Capacitor reflects over plugin classes and @PluginMethod annotations.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}

# The native sensor bridge is registered by class reference from MainActivity.
-keep class com.helioforge.solar.** { *; }
