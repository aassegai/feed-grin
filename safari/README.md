# Feed Grin for Safari

The shared extension supports Safari on macOS, iOS, and iPadOS. User-post hiding,
ad-post hiding, and the trollface are enabled by default. Settings are local to
that browser installation. The extension works on the LinkedIn website in Safari,
not inside the LinkedIn app.

The package targets Safari 16.4 or later. The temporary-install option below is
only available in recent Safari versions; if the button is absent, use Xcode.

## Mac: load the ZIP temporarily

1. Download `feed-grin-safari-1.0.3.zip`.
2. In Safari, open Settings > Advanced and enable web developer features.
3. Open Settings > Developer > Add Temporary Extension, and select the ZIP.
   Authorize the unsigned extension when Safari asks.
4. In Settings > Extensions, enable Feed Grin and allow access to `linkedin.com`.
5. Reload LinkedIn. Open Feed Grin's toolbar popup to change settings.

Safari removes temporary extensions after 24 hours or when Safari quits.
See [Apple's installation instructions](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension).

## Mac, iPhone, and iPad: generate the Xcode project

Use a Mac with full Xcode installed and launched at least once. Download and
extract `feed-grin-safari-kit-1.0.3.zip`, open Terminal in that folder, then run:

```sh
bash create-xcode-project.command
```

From a Git checkout, run:

```sh
bash safari/create-xcode-project.command
```

The script generates both macOS and iOS targets in `build/` beside the script.
It uses `safari-web-extension-packager`, or the earlier
`safari-web-extension-converter` when that is the installed tool. It copies the
extension resources and refuses to overwrite an existing output directory.
To choose a platform or another output directory:

```sh
bash create-xcode-project.command macos /path/to/new-macos-project
bash create-xcode-project.command ios /path/to/new-ios-project
```

Open the generated `.xcodeproj` in Xcode. For Mac, choose the macOS app scheme
and Run. Enable the extension and website access in Safari Settings. Unsigned
development builds require Safari's Allow unsigned extensions setting.

For an iPhone/iPad, select the iOS app scheme and a simulator or connected device.
For a physical device, select your signing team in Signing & Capabilities for
both the app and extension, then Run. You may need to choose a unique bundle ID.
After installation, enable Feed Grin in Safari's extension settings, allow
LinkedIn access, and reload the website. Use Request Desktop Website if LinkedIn
serves a mobile layout the extension cannot recognize.

Set `FEED_GRIN_BUNDLE_ID` before running the script to use another app identifier.
The generated app and extension must use a compatible signing configuration.
Apple documents [packaging](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)
and [running on devices](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension).

## Alternative: Apple's browser-based packager

If you have an Apple Developer Program membership, App Store Connect can package
the Safari ZIP for macOS and iOS without a Mac or Xcode. Upload the ZIP through
Safari Web Extension Packager under Xcode Cloud. The resulting builds can be
used with TestFlight. This repository does not upload or submit anything.
[Apple's instructions](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect).

## Verification

The Chromium tests load the actual extension. The WebKit checks run the real
content and popup scripts with a test implementation of the extension APIs,
using local desktop and mobile feed fixtures. They check DOM behavior, defaults,
independent settings, images, navigation without the Navigation API, and layout.
These checks do not replace testing the packaged extension in Safari on Apple
hardware. Native app compilation and signing require Apple's tools or service;
this kit does not contain a prebuilt `.app` or `.ipa`.

Development commands:

```sh
npm install
npx playwright install chromium webkit
npm test
npm run test:safari
python3 tests/safari-package.py
npm run package:safari
```
