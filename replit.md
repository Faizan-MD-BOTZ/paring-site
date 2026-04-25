# JUNE-X Session Generator

## Overview
JUNE-X is a WhatsApp session pairing web application that allows users to generate session credentials via pair code or QR scan. The app features a modern cyberpunk-themed UI with live statistics dashboard.

## Project Architecture
- **voltah.js** - Main Express server with stats API, routes, and middleware
- **pair.js** - Pair code generation route using Baileys library
- **qr.js** - QR code generation route using Baileys library
- **id.js** - Random ID generator utility
- **main.html** - Landing page with stats dashboard, deploy platforms, and particle effects
- **pair.html** - Advanced pair code page with step progress, particle canvas, tips, security info
- **stats.json** - Auto-generated statistics file (gitignored)

## Key Features
- Live statistics dashboard (8 stat cards: total sessions, success rate, countries, etc.)
- Deploy platform buttons: Heroku, Render, CypherX Platform, Panel (Bot Hosting), Replit, Daki.cc
- Animated particle canvas background with connecting lines on both pages
- Advanced pair page with 3-step progress indicator, animated progress bar, tips section
- Security strip showing encryption and privacy info
- Responsive design for mobile/desktop
- Statistics tracking API (/api/stats)

## Deployment Files
- **Procfile** - Heroku deployment config
- **render.yaml** - Render deployment config
- **app.json** - Heroku one-click deploy config

## Deployment Platforms Supported
- Heroku (one-click deploy button)
- Render (render.yaml + deploy button)
- CypherX Platform (platform.cypherx.space)
- Panel / Bot Hosting (Pterodactyl-based)
- Replit (import from GitHub)
- Daki.cc (cloud hosting)

## Tech Stack
- Node.js 20+ / Express
- Baileys (WhatsApp Web API)
- Vanilla HTML/CSS/JS frontend
- Font Awesome icons, Google Fonts (Orbitron, Exo 2, JetBrains Mono)

## Running
- Default port: 5000 (configurable via PORT env var)
- Start command: `node voltah.js`

## Recent Changes
- 2026-02-14: Advanced pair.html with particle canvas, step progress, progress bar, tips, security strip
- 2026-02-14: Replaced GitHub Fork with Daki.cc in deploy platforms
- 2026-02-14: Removed GitHub Authorization section
- 2026-02-14: Complete UI redesign with cyberpunk theme, particle effects, 8 stat cards
