# C5 Games Android APK

This Capacitor app bundles the local C5 game collection and its assets. It does
not load the hosted website. Android 6.0 or newer is required.

From the repository root, rebuild with:

```powershell
npm run android:apk
```

The signed debug APK is copied to `artifacts/c5-games.apk`. Transfer that file to
an Android device and open it to install; allow installation from the app used
to open the file if Android asks.

The build script uses the JDK 21 and Android SDK in `.android-tools` when present.
Otherwise set `JAVA_HOME` and `ANDROID_HOME`. The SDK needs Android platform 35,
build tools 35.0.0, and platform tools. Gradle may install its required build tools.

This APK is for local installation and testing. It uses the machine's Android
debug signing key, not a production Play Store signing key. Keep that key to
install subsequent builds as updates.

The standard `npm run build` still produces the GitHub Pages version. The Android
build uses relative asset paths through `npm run build:android`.
