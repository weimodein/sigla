# Add project specific ProGuard rules here.

# Retrofit + OkHttp
#
# Release-only crash fixed here: every `suspend fun` in ApiService (e.g.
# getLatestModel) threw "java.lang.Class cannot be cast to
# java.lang.reflect.ParameterizedType" from retrofit2.HttpServiceMethod the
# first time it was called — surfaced in the app as the generic "Network
# error" toast in WordBankActivity/CategoryWordListActivity, which swallows
# the real exception. Retrofit reads each method's generic return type via
# reflection to build the response adapter; R8 stripped the EnclosingMethod
# attribute AND the synthetic Kotlin Continuation parameter that only exists
# in the compiled bytecode of a suspend fun (Retrofit's suspend support
# rewrites `suspend fun x(): T` to `fun x(continuation: Continuation<T>): Any`
# under the hood), so by the time Retrofit inspected it there was no
# ParameterizedType left to find. -keepattributes alone was not enough — R8
# needs these two rules from Retrofit's own consumer-rules.pro:
# https://github.com/square/retrofit/blob/master/retrofit/src/main/resources/META-INF/proguard/retrofit2.pro
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes EnclosingMethod
-keepattributes InnerClasses
-keep class retrofit2.** { *; }
-keep interface retrofit2.** { *; }
-keepclassmembernames interface * {
    @retrofit2.http.* <methods>;
}
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}
# With R8 full mode, Kotlin coroutine suspend functions are not properly
# kept: the Continuation parameter's generic signature is stripped even with
# Signature above, unless the Continuation class itself is explicitly kept.
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-dontwarn retrofit2.**
-dontwarn okhttp3.**
-dontwarn okio.**

# Gson
-keep class com.google.gson.** { *; }
-keep class * implements com.google.gson.TypeAdapterFactory
-keep class * implements com.google.gson.JsonSerializer
-keep class * implements com.google.gson.JsonDeserializer
-keepclassmembers,allowobfuscation class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# All app classes — keep everything in the app package
-keep class com.example.sigla.** { *; }

# TensorFlow Lite
-keep class org.tensorflow.** { *; }
-keep interface org.tensorflow.** { *; }
-dontwarn org.tensorflow.**

# MediaPipe
-keep class com.google.mediapipe.** { *; }
-keep interface com.google.mediapipe.** { *; }
-dontwarn com.google.mediapipe.**

# Flogger — Google's logging library, used internally by MediaPipe.
#
# Release-only failure fixed here: HandLandmarker/PoseLandmarker
# createFromOptions() threw from com.google.mediapipe.framework.Graph's static
# initializer:
#   ExceptionInInitializerError
#   Caused by: IllegalStateException: no caller found on the stack for: i1.c
# i1.c was R8's name for com.google.common.flogger.FluentLogger (confirmed in
# build/outputs/mapping/release/mapping.txt). Graph declares its logger with
# FluentLogger.forEnclosingClass(), which walks the stack looking for the frame
# just below FluentLogger's own class name to find the class that created it.
# Once R8 renamed or inlined Flogger, that lookup found nothing and threw — on
# both the GPU and the CPU path, so both landmarkers stayed null. In the app
# the status still read "Models loaded" (PredictionService never touches
# MediaPipe), but no hand overlay drew and no sign was ever recognized.
# Flogger is not under com.google.mediapipe, so the rule above never covered it.
-keep class com.google.common.flogger.** { *; }
-dontwarn com.google.common.flogger.**

# Protobuf (lite) — MediaPipe's task options are protobuf messages.
#
# The next release-only failure behind the Flogger one, same symptom (no
# overlay, no recognition):
#   Field typeUrl_ for com.google.protobuf.g not found
# Protobuf-lite builds each message's schema by looking its fields up BY NAME
# via reflection. R8 renamed com.google.protobuf.Any to `g` and its typeUrl_
# field along with it. MediaPipe's own generated messages were already safe
# under com.google.mediapipe.**; protobuf's built-in types (Any, and anything
# else under com.google.protobuf) were not.
-keep class com.google.protobuf.** { *; }
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite { <fields>; }
-dontwarn com.google.protobuf.**

# AndroidX Security (EncryptedSharedPreferences)
-keep class androidx.security.crypto.** { *; }

# AndroidX Camera
-keep class androidx.camera.** { *; }
-dontwarn androidx.camera.**

# Glide
-keep public class * implements com.bumptech.glide.module.GlideModule
-keep class com.bumptech.glide.** { *; }
-dontwarn com.bumptech.glide.**

# Coroutines
-keepclassmembernames class kotlinx.** { volatile <fields>; }
-dontwarn kotlinx.coroutines.**

# Suppress missing class warnings from annotation processing dependencies (autovalue/javapoet)
-dontwarn javax.lang.model.SourceVersion
-dontwarn javax.lang.model.element.Element
-dontwarn javax.lang.model.element.ElementKind
-dontwarn javax.lang.model.element.Modifier
-dontwarn javax.lang.model.type.TypeMirror
-dontwarn javax.lang.model.type.TypeVisitor
-dontwarn javax.lang.model.util.SimpleTypeVisitor8
