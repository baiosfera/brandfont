# Brandfont — Sovereign Brandmark & Font Workbench Runtime

Brandfont is a high-performance font workbench and brandmark preview runtime for Zerops. It allows parametric inspection of typography, OpenType ligatures, stylistic sets, and catalog management for brand identities.

## Features

- **Native OpenType Typography**: Interactive previews for local OTF/TTF/WOFF/WOFF2 fonts and Google Fonts.
- **Parametric Brandmark Workbench**: Live letter, word, and block styling with aspect ratio lock and SVG export.
- **Server Catalog Synchronization**: Hybrid persistence backed by local storage and server `catalog.json`.
- **Zero-Dependency Runtime**: Built on native Node.js / Bun HTTP server for sub-millisecond startup and minimal footprint.
- **Zerops Native Deployment**: Configured out of the box for Zerops Incus LXC runtimes (`alpine/nodejs@22`).

## Project Structure

```
├── index.html            # Main workbench interface
├── preview_gallery.html  # High-density font comparison gallery
├── catalog.json          # Persistent font metadata catalog
├── manifest.json         # Extracted font attributes & SVG previews
├── fonts/                # Local OpenType font files
├── server.js             # Zero-dependency static & API HTTP server
├── zerops.yaml           # Zerops deployment recipe
└── package.json          # Node.js project manifest
```

## Local Development

Run the server with Node.js:

```bash
node server.js
```

Or with Bun:

```bash
bun run server.js
```

Open `http://localhost:3000` in your browser.

## API Endpoints

- `GET /health` — Health check endpoint for container orchestrators.
- `GET /api/fonts` — Returns the current font catalog.
- `POST /api/fonts` — Updates font catalog entries.
- `GET /api/render` — Upstream proxy for font preview vectors.
- `GET /api/extract` — Font metadata extraction from asset URLs.

## Deployment on Zerops

Brandfont deploys automatically via Zerops pipelines using `zerops.yaml`.
