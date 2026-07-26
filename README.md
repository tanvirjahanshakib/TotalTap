# TotalTap

A calculator that doubles as an expense tracker — do the math, tap a category, and it's logged and totalled automatically, month by month.

This folder is a ready-to-push project: a Vite + React web build wrapped into an Android app with [Capacitor](https://capacitorjs.com/). It includes:

- `src/App.jsx` — the app UI (ported from the original prototype), now with a **বাং / EN language toggle** button in the top bar of every screen, and the **TotalTap icon** shown next to the title on the calculator screen.
- `resources/icon.png`, `resources/splash.png` — your uploaded app icon, used to auto-generate all Android icon/splash sizes at build time.
- `.github/workflows/release.yml` — a GitHub Action that builds an Android **APK automatically** whenever you publish a GitHub Release, and attaches it to that release.

## 1. Push this to your repo

Your repo (`tanvirjahanshakib/TotalTap`) is currently empty. From inside this folder:

```bash
git init
git remote add origin https://github.com/tanvirjahanshakib/TotalTap.git
git add .
git commit -m "TotalTap: initial app + icon + language toggle + release workflow"
git branch -M main
git push -u origin main
```

## 2. Get an APK

Once pushed, go to your repo's **Releases** tab → **Draft a new release** → fill in a tag (e.g. `v1.0.0`) → **Publish release**.

The Action will:
1. Build the web app
2. Wrap it into an Android project with Capacitor
3. Generate all icon/splash sizes from `resources/icon.png`
4. Build a debug APK
5. Attach the `.apk` file directly to your Release

You can also trigger a test build any time without publishing a release: go to **Actions → Build & Attach Android APK → Run workflow**. The APK will be available there as a downloadable artifact.

## 3. Local development (optional)

```bash
npm install
npm run dev        # preview the web version in a browser
npm run build       # build web assets
npx cap add android # first time only
npx cap sync android
```

## Notes

- The generated APK is a **debug build** (unsigned) — that's enough to install directly on a device or share for testing, but the Play Store requires a **signed release build**. If/when you're ready for that, you'll need to generate a keystore and extend the workflow to sign with it — happy to help set that up when you get there.
- The `android/` folder is intentionally not committed — the workflow regenerates it fresh on every build from `capacitor.config.json` + `resources/`, so there's nothing native to keep in sync by hand.
