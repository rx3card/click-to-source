# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[semantic versioning](https://semver.org/).

## [0.1.0] - 2026-06-28

The first working release.

### Added
- A panel that embeds your running dev server inside VS Code.
- A status bar button to open the panel in one click, without the Command Palette.
- An element selector: hover to highlight, click to jump to the source file.
- React / Next.js support (React 19) by reading debug stacks and resolving them
  through Turbopack and webpack source maps to the original `.tsx`/`.jsx` line.
- Support for explicit source attributes (`data-inspector-*`, `data-source`).
- Vue single-file component detection.
- A DOM-fingerprint fallback that locates elements in plain HTML and in
  server-rendered templates (Flask, Django, PHP, EJS, Handlebars, and more).
- A graceful "search the workspace" fallback when an element can't be pinpointed.
- A configurable dev server URL (`clickToSource.devServerUrl`).
