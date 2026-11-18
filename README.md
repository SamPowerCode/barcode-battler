# BARBRAWL

A mobile web game: scan any barcode with your phone's camera to get a fighter, then battle, collect items and level up. Installable as an app (PWA) and playable offline after the first visit.

## Develop

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # game logic tests
npm run build        # production build in dist/
```

### Test on an Android phone over USB

The camera only works on secure pages. Chrome treats `localhost` as secure, so forward the dev server to the phone:

1. On the phone, enable Developer options → USB debugging, plug in, and accept the prompt.
2. Run `npm run dev:android` (runs `adb reverse tcp:5173 tcp:5173`, then starts Vite).
3. On the phone, open Chrome at `http://localhost:5173`.

## Layout

- `src/game.js` – pure rules (barcode → fighter, damage, XP). Unit tested in `tests/`.
- `src/scanner.js` – live camera scanner. Uses Chrome's built-in `BarcodeDetector`, falls back to a self-hosted zxing-wasm reader.
- `src/main.js` – handheld UI, screens, battle flow, saving.
- `scripts/make-icons.mjs` – regenerates `public/icons/*` (`npm run icons`).
- `preview/artifact.html` – the single-file claude.ai preview (separate from the app).

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which tests, builds and publishes `dist/` to GitHub Pages. In the repo settings, set Pages → Source to **GitHub Actions**.
