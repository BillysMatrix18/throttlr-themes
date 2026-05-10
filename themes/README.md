# Throttlr Themes

Full GUI themes for [Throttlr](https://github.com/BillysMatrix18/throttlr) — the per-app network throttling tool for Windows.

Themes here aren't just color tints. Each one is a **complete visual reskin** of the app — different fonts, panel shapes, button styles, animations, the whole vibe. Same kind of thing as the built-in Industrial / Midnight / Windows 7 / Optimised designs.

The themes website ([throttlr-themes.netlify.app](https://throttlr-themes.netlify.app)) reads this folder live via the GitHub API, so adding a new theme is just dropping the files in this folder.

## How a theme works

Each theme is **two files** at the top level of this folder, paired by name:

```
themes/
├── neon-cyberpunk.json    ← manifest (metadata + preview info)
└── neon-cyberpunk.css     ← the actual full-theme CSS
```

The JSON file is the manifest — it describes the theme to the gallery website (name, author, preview colors, etc). The CSS file is the actual styling that gets injected into Throttlr when the user activates the theme.

## How to install a theme (for users)

1. Go to [throttlr-themes.netlify.app](https://throttlr-themes.netlify.app)
2. Click **Download** on a theme card → saves both `<theme>.json` and `<theme>.css` to your downloads
3. Open Throttlr → **Settings → Appearance → Open themes folder**
4. Drop both files into that folder
5. Restart Throttlr (or click "Rescan") → your new theme appears as a tile
6. Click the tile to apply

## How to make a theme (for contributors)

### Manifest (`<theme-id>.json`)

```json
{
  "id":          "my-theme",
  "name":        "My Theme",
  "author":      "@yourname",
  "version":     "1.0.0",
  "description": "Short tagline about the vibe",
  "base":        "midnight",
  "css_file":    "my-theme.css",
  "preview": {
    "bg":      "#0a0014",
    "panel":   "#180a30",
    "accent":  "#ff00aa",
    "accent2": "#00f5ff",
    "text":    "#e0d0ff",
    "font":    "JetBrains Mono"
  }
}
```

| Field | Required | What it does |
|---|---|---|
| `id` | ✅ | Unique theme ID. Used in CSS selectors as `body[data-theme="<id>"]`. Must be `kebab-case`. |
| `name` | ✅ | Display name shown on the theme tile + Settings UI |
| `author` | ✅ | Your handle / name |
| `version` | ✅ | Semver string — bump when you update |
| `base` | ✅ | Which built-in theme to inherit from. One of `industrial`, `midnight`, `windows7`, `optimised`. Your CSS overrides on top of this base. |
| `css_file` | ✅ | Filename of the companion CSS (usually `<id>.css`) |
| `description` | optional | Short one-liner shown on gallery cards |
| `preview` | ✅ | Colors + font shown on the gallery card preview. Doesn't affect the actual theme — just the website's preview tile. |
| `preview.bg` | ✅ | Background color of the preview rectangle |
| `preview.panel` | optional | Inner panel color (one shade up from bg) |
| `preview.accent` | ✅ | Primary accent color — drawn as the card's title |
| `preview.accent2` | optional | Secondary accent — used in the gradient strip across the top |
| `preview.text` | optional | Body text color — used for the small caption under the title |
| `preview.font` | optional | Font name to render the title in. Allowed: `JetBrains Mono`, `Quicksand`, `Fredoka`, `Press Start 2P`, `VT323`, `Space Mono`, `IBM Plex Mono`, `IBM Plex Sans`, `Roboto Mono`, `Source Code Pro`, `Orbitron`, `Audiowide`, `Major Mono Display`, `Share Tech Mono`. Anything else falls back to a generic stencil/sans. |

### CSS file (`<theme-id>.css`)

The CSS file uses `body[data-theme="<id>"]` as the root selector for everything. This selector has higher specificity than the base theme's `body[data-design="<base>"]`, so your overrides win.

Minimal CSS file structure:

```css
/* Import any custom fonts you need from Google Fonts */
@import url('https://fonts.googleapis.com/css2?family=YourFont&display=swap');

/* Re-map the design tokens */
body[data-theme="my-theme"] {
  --bg:       #0a0014;
  --bg-2:     #140828;
  --hazard:   #ff00aa;
  --bone:     #e0d0ff;
  /* ...etc... */
  background: #0a0014;
  color: #e0d0ff;
  font-family: 'YourFont', sans-serif;
}

/* Override specific components */
body[data-theme="my-theme"] .modal { ... }
body[data-theme="my-theme"] .btn-stencil { ... }
body[data-theme="my-theme"] button { ... }
/* ...etc... */
```

### How activation works (app side)

When the user clicks your theme's tile in Settings, the app:

1. Sets `body.dataset.design = base` (activates the base built-in theme as foundation)
2. Sets `body.dataset.theme = "<your-id>"` (activates your overrides)
3. Injects your CSS file's content into a `<style id="custom-theme-css">` tag

So you get full inheritance from the base theme, plus full override power for anything you want to change. If you don't override something, it falls back to the base theme's value.

### Common tokens to override

The most visually impactful CSS variables in Throttlr:

| Token | What it controls |
|---|---|
| `--bg` | Main app background |
| `--bg-2` | Panel / card background (one level up from bg) |
| `--bg-3` | Sub-panel / nested card |
| `--bg-4` | Hover / active surface |
| `--steel` | Panel borders |
| `--hazard` | Primary accent — buttons, highlights, the hazard tape |
| `--hazard-deep` | Darker accent variant |
| `--hazard-grad` | Accent gradient (used for grad-text) |
| `--bone` | Main text color |
| `--bone-dim` | Muted / secondary text |
| `--term` | "Running" green (semantic — usually leave alone) |
| `--blood` | "Drop" red (semantic — usually leave alone) |

### Common selectors to override

The high-impact selectors that most themes will want to restyle:

```css
body[data-theme="..."] .modal,
body[data-theme="..."] .panel,
body[data-theme="..."] .stat-cell,
body[data-theme="..."] .preset-card,
body[data-theme="..."] .func-panel { ... }      /* panel boxes */

body[data-theme="..."] .titlebar { ... }         /* top bar */
body[data-theme="..."] .modal-head { ... }       /* modal headers */
body[data-theme="..."] .tab-btn { ... }          /* tab buttons */
body[data-theme="..."] .preset-tab { ... }       /* preset tabs */

body[data-theme="..."] button,
body[data-theme="..."] .btn-stencil,
body[data-theme="..."] .btn-hazard,
body[data-theme="..."] .hotkey-btn { ... }       /* buttons */

body[data-theme="..."] input,
body[data-theme="..."] select,
body[data-theme="..."] textarea { ... }          /* inputs */

body[data-theme="..."] .field-label,
body[data-theme="..."] .panel-title,
body[data-theme="..."] .stat-label { ... }       /* headings */

body[data-theme="..."] .toolrail,
body[data-theme="..."] .trb { ... }              /* left navigation rail */

body[data-theme="..."] .toast { ... }            /* notifications */

body[data-theme="..."] .stat-value,
body[data-theme="..."] .big-stat-value { ... }   /* numeric readouts */

body[data-theme="..."] .cl-version,
body[data-theme="..."] .cl-head,
body[data-theme="..."] .cl-changes li { ... }    /* changelog modal */
```

Read the CSS files of the existing themes (`neon-cyberpunk.css`, `terminal-green.css`, `y2k-bubblegum.css`) for working examples of how to structure a full theme.

## How to submit a theme

1. **Fork** the [Throttlr Themes repo](https://github.com/BillysMatrix18/throttlr-themes)
2. Create your manifest in `themes/your-theme.json`
3. Create your CSS in `themes/your-theme.css`
4. Test locally: drop both files in `%USERPROFILE%\.throttlr\themes\`, restart Throttlr, make sure it looks how you want
5. Open a **Pull Request** with both files
6. Once merged, your theme shows up at [throttlr-themes.netlify.app](https://throttlr-themes.netlify.app) automatically — no website redeploy needed

### Submission guidelines

- **One theme per pair of files.** No bundles.
- **Filename `kebab-case.json` + `kebab-case.css`** matching the theme's `id`.
- **Test it.** Make sure text is readable on the background, status colors still pop, every modal still opens.
- **Be original-ish.** No themes copying a brand's exact identity (Coca-Cola red, Twitch purple, Discord, etc.) — those are trademarked and we'll have to remove them.
- **No NSFW themes.** Common sense applies.
- **Keep contrast usable.** A theme where text and background have near-zero contrast is unreadable. Aim for at least 4.5:1 contrast ratio between text + bg.
- **Respect status colors.** The "running" green, "drop" red, "replay" cyan all have semantic meaning. You can shift their hue but don't make them unrecognizable.

## Questions?

Open an issue on the repo or ping [@BillysMatrix18](https://github.com/BillysMatrix18).
