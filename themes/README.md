# Throttlr Themes

Community-made color themes for [Throttlr](https://github.com/BillysMatrix18/throttlr).

Each `.json` file in this folder is a theme. The themes website
([throttlr.netlify.app/themes](https://throttlr.netlify.app/themes)) reads
this folder live via the GitHub API, so adding a new theme is just dropping
a JSON file here — the gallery picks it up automatically within a couple
minutes (or when the visitor's 1-hour cache expires).

## How to use a theme (for users)

1. Go to [throttlr.netlify.app/themes](https://throttlr.netlify.app/themes)
2. Click **Download** on a theme card → saves the `.json` to your downloads folder
3. Open Throttlr → **Settings → Appearance → Open themes folder**
4. Drop the `.json` file into that folder
5. Restart Throttlr (or click "Rescan") → your new theme appears as a tile
6. Click the tile to apply

## How to make a theme (for contributors)

A theme is a JSON file with this shape:

```json
{
  "name":        "My Theme",
  "author":      "@yourname",
  "version":     "1.0.0",
  "description": "Optional one-liner about the vibe",
  "base":        "industrial",
  "preview":     "#ff66cc",
  "colors": {
    "bg":         "#1a0a2a",
    "bg_panel":   "#251530",
    "bg_raised":  "#2e1a3d",
    "accent":     "#ff66cc",
    "accent_dim": "#aa3380",
    "text":       "#e0d8f0",
    "text_dim":   "#9b8aa6",
    "border":     "#3a2a4a"
  },
  "overlay": {
    "bg":     "#1a0a2a",
    "accent": "#ff66cc",
    "text":   "#e0d8f0"
  }
}
```

### Required fields

| Field | What it does |
|---|---|
| `name` | Display name shown on the theme tile |
| `author` | Your handle / name (shown on the card) |
| `version` | Semver string — bump it when you update |
| `base` | Which built-in theme to inherit from. One of `"industrial"`, `"midnight"`, `"windows7"`, `"optimised"` |
| `preview` | A hex color used for the swatch on the gallery card. Usually your accent. |

### Optional fields

| Field | What it does |
|---|---|
| `description` | Short one-liner shown on the card |
| `colors` | Overrides the main app's CSS variables. Only set the keys you want to change — anything you don't set inherits from the `base` theme. |
| `overlay` | Overrides for the floating overlay window. Same idea — set what you want, the rest inherits. |

### Color keys reference

The `colors` object can override any of these:

| Key | What it controls |
|---|---|
| `bg`         | Main app background |
| `bg_panel`   | Panel / card backgrounds (one level up from bg) |
| `bg_raised`  | Hover / active surface (two levels up) |
| `accent`     | Primary accent — buttons, highlights, the hazard tape on Industrial |
| `accent_dim` | Darker accent variant for secondary elements |
| `text`       | Main text color |
| `text_dim`   | Secondary / muted text |
| `border`     | Panel borders |
| `success`    | The "running" green (semantic — usually keep default) |
| `error`      | The "drop" red (semantic — usually keep default) |
| `warning`    | The "freeze" cyan (semantic — usually keep default) |

The `overlay` object can override:

| Key | What it controls |
|---|---|
| `bg`     | Overlay window background |
| `accent` | Overlay tape / border / RATE display |
| `text`   | Overlay text |

Status colors in the overlay (running = green, drop = red, replay = cyan)
intentionally don't theme — they have semantic meaning that's more
important than visual coherence with the theme.

### Minimum viable theme

You don't have to define everything. The smallest valid theme is just:

```json
{
  "name":    "Just Pink",
  "author":  "@me",
  "version": "1.0.0",
  "base":    "midnight",
  "preview": "#ff66cc",
  "colors":  { "accent": "#ff66cc" }
}
```

That re-skins the midnight theme with a pink accent. Everything else
inherits.

## How to submit a theme

1. **Fork** the [Throttlr Themes repo](https://github.com/BillysMatrix18/throttlr-themes)
2. Create your theme JSON in `themes/your-theme-name.json`
3. Test it locally: drop the file in `%USERPROFILE%\.throttlr\themes\`,
   restart Throttlr, make sure it looks how you want
4. Open a **Pull Request** with the new file
5. Once merged, your theme shows up at
   [throttlr-themes.netlify.app](https://throttlr-themes.netlify.app)
   automatically — no website redeploy needed

### Submission guidelines

- **One theme per file.** No bundles.
- **Filename should be `kebab-case.json`** matching the theme name (e.g.
  `cyberpunk-noir.json` not `Cyberpunk_Noir.json`)
- **Test it.** Make sure text is readable on the background, status colors
  still pop, the overlay works in both running and idle states.
- **Be original-ish.** No themes that copy a brand's exact identity (Coca-Cola
  red, Twitch purple, etc.) — those are trademarked and we'll have to remove
  them.
- **No NSFW themes.** Use common sense.
- **Keep accent contrast usable.** A theme where the accent and bg have
  near-zero contrast is unreadable. Aim for at least 4.5:1 contrast ratio
  between text + bg.

## Examples in this folder

Browse the existing themes for reference. Read their JSON to see how the
fields are used in practice.

## Questions?

Open an issue on the repo or ping [@BillysMatrix18](https://github.com/BillysMatrix18).
