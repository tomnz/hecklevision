## Overview

A really basic Flask application that accepts [Slack slash commands](https://api.slack.com/interactivity/slash-commands#app_command_handling) (e.g. `/heckle His face looks like grilled cheese!`) or messages from a specific channel, and turns them into on-screen messages for overlay onto a movie stream. Similar in concept to [the Hecklevision idea from Central Cinema](https://www.central-cinema.com/hecklevision).

Messages appear in order received (newest at the top) and disappear after a set duration. Styling is plain HTML/CSS; dynamic bits are vanilla JS (no Babel — modern browsers only, which matches the OBS Browser Source / Chromium target).

Message state is in-process memory only — no persistence. Restarts wipe history, and we only keep the latest ~100 anyway.

In production the app is served through a front-door RTMP + reverse-proxy server (see [hecklevision-server](https://github.com/tomnz/hecklevision-server)) which stitches HLS live streaming onto the same origin.

## Setup

You'll need to [create a Slack app / bot user](https://api.slack.com/apps) for your workspace and set the bot user OAuth token (`SLACK_BOT_TOKEN`) and signing secret (`SLACK_SIGNING_SECRET`) as environment variables before running.

```sh
# Python 3.12 (matches runtime.txt; 3.11 / 3.13 likely work too)
pip install -r requirements.txt

SLACK_BOT_TOKEN=xoxb-... \
SLACK_SIGNING_SECRET=... \
python app.py
```

Server comes up on [localhost:7000](http://localhost:7000). Set `ENABLE_BOT_RELAY=1` if you want `/post` and `/submit` to also post back into the Slack `#heckle` channel.

Simulate a slash-command submission with a manual POST:

```sh
curl --data-urlencode 'user_name=tom' \
     --data-urlencode 'text=His face looks like grilled cheese!' \
     http://localhost:7000/submit
```

## Endpoints

| Path | What it does |
|---|---|
| `/` | Video.js player view (the main overlay page) |
| `/messages` | Message-stack template (used as an OBS Browser Source overlay) |
| `/submit` | GET shows a manual submission form; POST accepts it |
| `/post` | Slack slash-command endpoint (expects Slack's form-encoded POST) |
| `/get` | JSON poll endpoint for the frontend — supports `?after=<timestamp>` |
| `/emoji` | JSON map of custom Slack emojis by name → image URL |
| `/slack-actions` | Slack Events API webhook (signature-verified via `slack_sdk.SignatureVerifier`) |

## Development

* `static/messages.js` — polling + rendering loop for the overlay
* `static/player.js` — video.js init for the live HLS stream (same-origin `/live/*.m3u8`)
* `static/*.css` — styling
* `templates/*.html` — page skeletons
* `app.py` — Flask backend. Run with `debug=True` locally so Flask serves static assets and hot-reloads on save. Stakes are low.
* `Procfile` / `runtime.txt` / `requirements.txt` — Heroku config

## Deployment

Pushes to `master` are automatically deployed to Heroku. To iterate, push to a branch and open a PR, or push directly to `master` if you're confident.

The production URL isn't in this README since the app isn't hardened for exposure — reach out if you need access.
