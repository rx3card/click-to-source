# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[semantic versioning](https://semver.org/).

## [0.2.0] - 2026-06-28

### Added
- A built-in local proxy (on by default, `clickToSource.proxy`) so any project
  works inside the panel with no setup:
  - It rewrites session cookies to SameSite=None; Secure, so logging in inside
    the panel persists instead of kicking you back to the login page.
  - It injects the inspector client into HTML automatically, so you no longer
    have to copy a script into each project.
- An "Open in browser" button in the panel toolbar, useful as a fallback for
  pages behind a login.

## [0.1.1] - 2026-06-28

### Added
- A clear "no server running" message in the panel when nothing answers at the
  configured URL, with a Retry button, instead of a blank white screen.

### Fixed
- The selector now stays in sync after the page (re)loads, so toggling it on or
  off applies immediately without needing a manual reload.

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
