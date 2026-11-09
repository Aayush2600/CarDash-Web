# CarDash

**A free, open-source, CarPlay-style dashboard for your phone.** Turn-by-turn navigation and your Spotify on one screen, in the browser. No app store, no account with us, no tracking.

- 🗺️ **Navigation**: OpenStreetMap maps, a route line, a turn banner, ETA, voice directions and automatic rerouting
- 🔎 **Search**: places and addresses, preferring results near you
- 🎵 **Spotify**: current song, album art, play/pause/skip. You control **your own** Spotify app.
- 🚗 **Car layout**: dock, map and music side by side in landscape; stacked in portrait. Large buttons, and the screen stays on.
- 💸 **Free**: no servers of our own, no API keys to buy

**Requirements:** Spotify Premium (Spotify only allows remote control for Premium accounts).

## Use it

1. Open the site on your phone.
2. Add it to your home screen. On iPhone: Share → **Add to Home Screen**. On Android: ⋮ → **Install app**.
3. Tap **Connect Spotify** and follow the 3-minute one-time setup.

### Why do I create my own Spotify "app"?
Spotify limits each website to 5 users unless it's run by a large company. So each person registers a free personal Spotify developer app and pastes its Client ID. You log in with your own account, and your login stays in your browser. CarDash has no server and never sees it.

## Limits worth knowing

- **No live traffic.** ETAs are based on typical speeds.
- **On iPhone, guidance pauses when you leave the app or lock the screen.** All web apps on iOS work this way; keep CarDash on screen while driving.
- Search uses OpenStreetMap data, so some shops and malls may be missing or named differently than on Google.
- The free public routing and search servers are for fair use. See *Scaling* below.

**Safety:** set your destination before you drive. Don't operate your phone while driving, and always follow road signs and traffic laws over the app.

## How it works

Plain HTML, CSS and JavaScript with no build step.

| Part | Service | Cost |
|---|---|---|
| Map tiles | [OpenFreeMap](https://openfreemap.org) + [MapLibre GL JS](https://maplibre.org) | free |
| Routing + turn instructions | [Valhalla](https://github.com/valhalla/valhalla) on the FOSSGIS public server | free (fair use) |
| Search | [Photon](https://photon.komoot.io) by komoot | free (fair use) |
| Music | [Spotify Web API](https://developer.spotify.com/documentation/web-api) with PKCE, using the user's own Client ID | free (Premium needed) |
| Voice | The browser's built-in speech | free |
| Hosting | GitHub Pages | free |

```
index.html        layout
css/app.css       styles (portrait + landscape)
js/app.js         wiring, settings, now-playing UI
js/nav.js         map, routing, guidance, voice, simulated driving
js/spotify.js     Spotify login (PKCE) + playback control
js/search.js      place search
sw.js             offline app shell / installable
```

### Run locally
```bash
python -m http.server 8000
```
Then open http://127.0.0.1:8000. Spotify only accepts `127.0.0.1` for local redirect URIs, not `localhost`. Turn on **Settings → Simulate driving** to test guidance at your desk.

## Scaling

The routing (FOSSGIS) and search (komoot) servers are donated community resources meant for moderate use. If CarDash gets popular, the plan is to:
1. Run our own Valhalla and Photon servers (an India-only Valhalla needs about 8 GB RAM, roughly $10–20/month).
2. Fund them through GitHub Sponsors / Open Collective.

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Tiles: OpenFreeMap / OpenMapTiles. Routing: Valhalla, hosted by FOSSGIS e.V. Search: Photon by komoot. Not affiliated with Spotify, Apple or Google.

## License

MIT
