# Throttlr Themes

Community-made themes for [Throttlr](https://github.com/BillysMatrix18/throttlr) — the per-app network throttling tool for Windows.

This repo hosts:

1. **The themes gallery website** ([throttlr-themes.netlify.app](https://throttlr-themes.netlify.app)) — `index.html`
2. **The theme files themselves** — everything in [`/themes`](./themes)

The website page reads `/themes` live via the GitHub API, so adding a new theme is just dropping a JSON file in the folder. No website redeploy needed.

## I just want to use a theme

Go to **[throttlr-themes.netlify.app](https://throttlr-themes.netlify.app)**, pick one, click Download, drop it in your Throttlr themes folder.

## I want to make a theme

Read **[themes/README.md](./themes/README.md)** for the JSON format, then:

1. Fork this repo
2. Add `themes/your-theme-name.json`
3. Test locally
4. Open a pull request

Once merged it appears on the gallery automatically.

## Why is this a separate repo from the main Throttlr app?

So the gallery has its own life — separate deploys, separate releases, separate contribution flow. The main app repo doesn't need to ship a new version every time someone submits a new theme.

---

MIT licensed. Built by [@BillysMatrix18](https://github.com/BillysMatrix18).
