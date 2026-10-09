## Overview

A really basic Flask application that accepts [Slack slash commands](https://api.slack.com/interactivity/slash-commands#app_command_handling) (e.g. `/heckle His face looks like grilled cheese!`) or messages from a specific channel, and turns them into on-screen messages for overlay onto a movie stream. Similar in concept to [the Hecklevision idea from Central Cinema](https://www.central-cinema.com/hecklevision).

Messages appear in order received (newest at the top) and disappear after a set duration. Styling is plain HTML/CSS; dynamic bits are vanilla JS (no Babel — modern browsers only, which matches the OBS Browser Source / Chromium target).

Message state is in-process memory only — no persistence. Restarts wipe history, and we only keep the latest ~100 anyway.

In production the app is served through a front-door RTMP + reverse-proxy server (see [hecklevision-server](https://github.com/tomnz/hecklevision-server)) which stitches HLS live streaming onto the same origin.

## Running locally

No Slack credentials are needed to try things out. Without `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` the app starts in local mode: Slack endpoints return 503 and there are no custom emoji, but everything else works.

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Then open, side by side:

* [localhost:7000/submit](http://localhost:7000/submit) — send messages (emoji autocomplete + live preview)
* [localhost:7000/messages](http://localhost:7000/messages) — the overlay, with emoji animations
* [localhost:7000/messages?history](http://localhost:7000/messages?history) — full history, no animations
* [localhost:7000/static/test-animations.html](http://localhost:7000/static/test-animations.html) — fire each animation style on demand

Flask runs with `debug=True`, so edits to templates and static files show up on refresh.

To run against Slack, you'll need to [create a Slack app / bot user](https://api.slack.com/apps) for your workspace and set the bot user OAuth token (`SLACK_BOT_TOKEN`) and signing secret (`SLACK_SIGNING_SECRET`):

```sh
SLACK_BOT_TOKEN=xoxb-... \
SLACK_SIGNING_SECRET=... \
.venv/bin/python app.py
```

Set `ENABLE_BOT_RELAY=1` if you want `/post` and `/submit` to also post back into the Slack `#heckle` channel.

Simulate a submission with a manual POST:

```sh
curl --data-urlencode 'user_name=tom' \
     --data-urlencode 'text=His face looks like grilled cheese!' \
     http://localhost:7000/submit
```

## Tests

Message rendering, emoji parsing and autocomplete live in `static/heckleText.js`, which has no DOM dependencies and is unit tested with Node's built-in runner (Node 20+, no `npm install` needed):

```sh
node --test
```

The Flask side (`heckle()` validation and throttling, Slack text cleanup, endpoints) is tested with the standard library's `unittest`, in local mode:

```sh
.venv/bin/python -m unittest discover tests
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

* `static/heckleText.js` — shared text rendering (emoji, escaping, autocomplete search); unit tested in `tests/`
* `static/messages.js` — polling + rendering loop for the overlay
* `static/messagesAnimate.js` — emoji animation engine
* `static/submit.js` — submit page (emoji autocomplete, preview)
* `static/player.js` — video.js init for the live HLS stream (same-origin `/live/*.m3u8`)
* `static/*.css` — styling
* `templates/*.html` — page skeletons
* `app.py` — Flask backend. Run with `debug=True` locally so Flask serves static assets and hot-reloads on save. Stakes are low.
* `Procfile` / `.python-version` / `requirements.txt` — Heroku config

## Deployment

Pushes to `master` are automatically deployed to Heroku. To iterate, push to a branch and open a PR, or push directly to `master` if you're confident.

The production URL isn't in this README since the app isn't hardened for exposure — reach out if you need access.
