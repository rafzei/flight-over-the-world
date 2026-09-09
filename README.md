# Flight Over the Earth

Fly over photorealistic Earth – guess the region, find your way home, or just explore. Single player and multiplayer.

**Play:** https://flightoverearth.com — the public Cesium ion quota is used up, so the game needs your own [Cesium ion](https://ion.cesium.com/) token pasted on the start screen.

![Flight over Paris](docs/screens/00-paryz.png)

![Flight over the fields](docs/screens/04-lot.png)

## Screens

<table>
  <tr>
    <td width="50%"><img src="docs/screens/01-start.png" alt="Start screen" /></td>
    <td width="50%"><img src="docs/screens/02-menu.png" alt="Plane and mode select" /></td>
  </tr>
  <tr>
    <td align="center">Start – single or multiplayer</td>
    <td align="center">Pick a plane, mode, and map range</td>
  </tr>
  <tr>
    <td><img src="docs/screens/06-ny.png" alt="Flight over New York" /></td>
    <td><img src="docs/screens/05-crash.png" alt="Crash" /></td>
  </tr>
  <tr>
    <td align="center">Fly anywhere</td>
    <td align="center">Stay careful :)</td>
  </tr>
</table>

## Modes

- **Guess the region** – one minute of flight, then mark on the map where you are (Poland / Europe / World).
- **Fly home** – start ~30 km from the address you enter, 10 minutes to get back.
- **Free flight** – pick a city and fly.
- **Land in Warsaw** – start 6 km before Warsaw Chopin runway 33, aligned with a 3° approach and landing gear down. Available for Piper, Q400, Citation, Boeing 737, Airbus A320 and Fighter.

## Vehicles

Nine vehicles are available in single player and multiplayer:

| Vehicle | Cruise / max speed | Flight characteristics and features |
| --- | --- | --- |
| **Piper PA-28** | ~170 / 470 km/h | Light propeller aircraft with animated propeller. |
| **Dash 8 Q400** | ~270 / 670 km/h | Regional turboprop with two animated propellers. |
| **Cessna Citation** | ~330 / 900 km/h | Business jet. |
| **Boeing 737-800** | ~830 / 970 km/h | Original simplified twin-engine airliner, blue tail and tall winglets. |
| **Airbus A320** | ~810 / 950 km/h | Original simplified twin-engine airliner, rounded nose and teal tail. |
| **Fighter** | ~540 / 1510 km/h | Combat jet with moving control surfaces, navigation lights, launchable missiles and wingtip contrails above 1000 km/h. |
| **Rocket** | ~790 / 5000 km/h | Forward-flying rocket with trails from four fins; engine fire appears above 5000 km/h. |
| **Combat Drone** | 120 / 320 km/h | Armed quadrotor replacing Rocket 1, with four spinning rotors, two rotating cannons firing 360° bursts, a camera and red lights. Independent lift and automatic braking; cutting throttle makes it descend under gravity. |
| **SpaceX Falcon 9** | Thrust-controlled / 8000 km/h | Upright rocket with nine engine nozzles, steering, gravity and inertia. Press `Enter` to release the Dragon capsule; its red-and-white parachute opens after separation. |

Speeds are game settings, not real-world specifications. Aircraft and the original Rocket can exceed their nominal maximum in a dive. Falcon 9 starts upright with zero speed and accelerates under engine thrust.

The drone uses `A` / `D` to turn, even at zero forward speed, and `W` / `S` to descend / climb while powered. Its throttle controls horizontal speed and rotor lift: at zero throttle it brakes and falls towards the ground; adding power restores altitude control. Falcon 9 uses `W` / `S` to tilt and `A` / `D` to turn; throttle controls thrust, so cutting it lets gravity pull the rocket down. The released Dragon descends separately while you continue controlling Falcon 9. The on-screen **Release Dragon** button also works on touch devices.

## Flight features

- Speed-sensitive controls for smoother steering at high speed.
- Above 20,000 m, the daytime sky fades into a star field with the Sun and Moon; the transition completes at 22,000 m and reverses on descent. This is an artistic high-altitude view, with fixed celestial directions rather than astronomical positions. Fog thins with the transition.
- Vehicle shadows on nearby terrain and buildings, softening and fading out by 180 m above the surface.
- Four camera views: chase, 3× farther, 5× farther and nose view; Falcon 9's nose camera points up its body axis.
- Full-screen map in free flight with mouse-wheel, `+` / `−` and pinch zoom. Zoom is remembered when reopening the map.
- Mouse-wheel throttle control anywhere in flight, plus a draggable throttle and touch flight stick.
- Contrails that follow the flight path, spread, drift and fade over time.
- Fighter missiles: press `Enter` to launch from alternating wing stations. Aim with the aircraft; missiles explode on terrain or building impact, with fire, smoke and sound. Each of the four stations reloads after 4 seconds. Launches are shared in multiplayer; a **Fire missile** button is available for touch controls.
- Drone cannons: press `Enter` or tap **Fire 360° burst** for a two-second burst. Both gun pods sweep a full circle in opposite directions while their barrels spin, firing bullets from the muzzles with flashes, golden tracers and sparks on terrain/building impacts. The cannons return forward and can fire again after a short cooldown. Bursts are visible in multiplayer.
- Multiplayer vehicle selection, player list and push-to-talk voice chat.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrow keys | Fly; drone and Falcon 9 controls are described above |
| Mouse wheel / drag throttle | Change throttle without selecting the slider first |
| `Shift` | Boost |
| `Ctrl` | Brake |
| `G` | Extend / retract landing gear (Piper has fixed gear) |
| `B` (hold) | Wheel brakes during landing rollout |
| `,` | Set minimum throttle |
| `.` | Set maximum throttle |
| `C` | Cycle camera: chase → 3× farther → 5× farther → nose view → fixed tracking → front |
| `M` | Open / close the map in free flight |
| Mouse wheel / `+` / `−` / pinch over the map | Zoom the map |
| `Enter` | Drone: fire a 360° cannon burst; Fighter: launch a missile; Falcon 9: release Dragon once per flight |
| `Tab` | Show multiplayer player list (hold) |
| `T` | Talk (hold) |
| `Esc` | Close map, pause single player, or open the multiplayer leave menu |
| `R` | Restart after a crash or finished flight |

Fixed tracking keeps the camera at its current location and turns it toward
the flying vehicle. The next `C` switches to an external front view that follows
the vehicle and looks back at it. Press `C` once more to return to normal chase.

## Landing in Warsaw

Choose **Single player → Land in Warsaw → Start**. Follow the runway centreline and the landing panel's target speed, descent rate and glide-path error. The marked threshold is displaced from the physical start of the pavement: touch down beyond the threshold stripes, near the paired aiming-point blocks.

Keep the wings level, reduce throttle near the runway and gently pull back with `S` to flare. The main wheels must touch first, with a small nose-up attitude and a low descent rate. After touchdown, let the nose settle, press `,` for idle and hold `B` to stop. `A` / `D` steer on the ground; sharp turns at speed can cause a runway excursion. For another takeoff, release the brakes, press `.` for full power and pull back after accelerating above approach speed. Gear and wheel-brake buttons also support touch input.

The aircraft rests on its wheels, with animated retractable gear, wheel rotation and suspension compression. Excessive sink can cause a bounce or gear failure; a belly landing, nose-first impact, wing strike or departure from the pavement ends the flight. `R` restarts the approach after a crash. Landing gear cannot retract while on the ground.

This is a simplified game flight model with descent inertia, flare, rollout drag and wheel braking. It is not a training simulator. The runway uses the published EPWA 15/33 location, 332° true heading, 3690 × 60 m dimensions and 661.4 m displaced threshold from [OurAirports runway data](https://ourairports.com/data/) ([source CSV](https://davidmegginson.github.io/ourairports-data/runways.csv)). Its elevation is calibrated against loaded map terrain before the practice approach; the visible surface and wheel collision share the same plane. Elsewhere, terrain impacts retain the existing crash behavior. Landing tests and browser checks can run with **Live traffic** off, without OpenSky credits.

## Contrail settings

Contrails appear above 1000 km/h. In `src/game/contrails.js`,
`CONTRAIL_DEFAULTS.lifetimeSeconds` controls their total lifetime (15 seconds),
and `fadeSeconds` controls the final fade (5 seconds). Both can also be passed
as options to `attachContrails(root, scene, { lifetimeSeconds: 15, fadeSeconds: 5 })`.
The original Rocket emits from four fins (`wingAxes: ["x", "y"]`); aircraft
emit from the left and right wing tips by default. Falcon 9 uses its engine plume.
`spreadMetersPerSecond` (0.35) controls how quickly the vapor widens, while
`driftMetersPerSecond` (0.12) controls its gentle turbulent drift. The cloud
pattern stays attached to the emitted trail as it spreads and loses density.

## Run it locally

Node.js 22+ and a free [Cesium ion](https://ion.cesium.com/) token.

```bash
git clone https://github.com/bartosz-ciesielski/flight-over-the-world.git
cd flight-over-the-world
npm install
cp .env.example .env
```

1. Create an account at [ion.cesium.com](https://ion.cesium.com/).
2. Create a token (Access tokens).
3. In My Assets add **Google Photorealistic 3D Tiles** (asset `2275207`).
4. Paste your token on the game's start screen and click **Save**. With `PUBLIC_MAP_LOCKED=true`, this user token is required locally too; `.env` map tokens do not unlock the map.

Use a separate Cesium ion account per token. On HTTP 429 the game keeps high tile quality and switches to the next key, then retries the tiles that failed. One key still works; more keys keep the map sharp under load.

```bash
npm run dev
```

Open the address from the terminal (usually `http://localhost:5173`). In multiplayer one player clicks Multiplayer, the other opens the copied link.

`npm run dev` listens on `0.0.0.0`, so devices on the same LAN can open the **Network** address printed by Vite (for example, `http://192.168.1.10:5173`). The host should open that address too before creating a multiplayer room, so the invite link contains the computer's LAN IP instead of `localhost`.

This starts both Vite and the traffic backend. If the default ports are occupied, use `npm run dev -- --port 5180 --traffic-port 3180`.

Do not commit the key – `.env` is in `.gitignore`. Tiles do not load in the menu, only after you start a flight.

## Live aircraft from OpenSky

Airborne contacts with fresh positions use Boeing 737 or Airbus A320 models when their ICAO type is supported, and red spheres otherwise. They use the globe's real coordinates and altitude, move between API updates, and obey camera direction, terrain depth and the horizon. Visibility follows the scene fog (about 24.7 km at low altitude, capped at 75 km); a larger area is fetched to include approaching aircraft. Traffic is informational and does not collide with the player or weapons. Distant models are enlarged up to 12× to keep their silhouettes readable.

Add backend credentials to `.env`:

```dotenv
OPEN_SKY_CLIENT_ID=your-client-id
OPEN_SKY_CLIENT_SECRET=your-client-secret
```

During a flight, use **Live traffic** to toggle markers. Under **Traffic details**, choose **Synthetic replay** to test without OpenSky credits, or disable movement prediction to inspect reported positions. Replay includes an inbound contact starting 35 km away, two contacts sharing a callsign, and a stale contact that must be rejected. It is explicitly labelled and never replaces live data automatically.

The backend obtains OAuth tokens and renews them before expiry. It polls on demand, normally every 30 seconds, and shares regional snapshots between viewers. The account's **4000 daily credits are an allowance, not the remaining balance**: the latter comes from `X-Rate-Limit-Remaining`. A durable ledger in `.data/opensky-budget.json` retains spending and cooldowns across restarts, keeps a 250-credit reserve and spaces upstream reads globally. More active regions, larger polar boxes and date-line splits reduce update frequency. Unknown balance stays unknown. HTTP 429 honors the provider's retry delay. No automatic anonymous fallback is used.

Positions older than 30 seconds are rejected on ingestion; existing tracks predict at most 30 seconds, fade out by 60 seconds and are removed after 90 seconds. An enabled transponder alone does not guarantee OpenSky coverage. `geo_altitude` is preferred; pressure altitude is a labelled fallback and may differ from terrain height.

OpenSky's state endpoint does not supply aircraft type. The backend resolves each `icao24` with `https://api.adsbdb.com/v0/aircraft/{icao24}`, verifies the returned Mode-S address and caches the ICAO type, registration and model name. Positive results last seven days, missing records one day; outages are retried after a minute. At most six cold lookups are made per snapshot and 30 per minute across the process. The cache is persisted in `.data/aircraft-metadata.json` (`TRAFFIC_METADATA_FILE` overrides it). Metadata lookups use no OpenSky credits, and live positions remain available when that service fails. A cold area may need several polling cycles to identify every contact.

Supported types: Boeing `B731`–`B739`, `B37M`, `B38M`, `B39M`, `B3XM`, and Airbus `A320`/`A20N`. 737 variants share a simplified 737 model with adjusted length; A320neo shares the simplified A320 silhouette. Other Airbus/Boeing types retain their actual type label and a red marker. Callsigns never determine the aircraft model. The menu's 737-800 and A320 use the same original geometry as traffic; no third-party model downloads are needed.

Useful commands:

```bash
npm test
npm run build
npm run traffic:server
# In another terminal, for the production frontend build:
npm run preview
# Optional real API diagnostic: one upstream read, separate from the server ledger:
npm run traffic:test-api -- --samples=1 --output=/private/tmp/opensky-check.json
```

`GET /api/traffic/health` reports backend availability/configuration. `GET /api/traffic?lat=52.23&lon=21.01&radiusKm=35` returns normalized contacts, freshness, coverage and the next polling interval. Browser diagnostics are available through `window.__foeDebug().traffic`; live quota observations are stored only on the backend. Never put OpenSky credentials in a `VITE_` variable.

## Hosting the traffic backend

GitHub Pages serves the frontend only. Live production traffic requires a separate HTTPS Node service. This repository includes a dependency-free backend container:

1. On the chosen server, set the two OpenSky variables and `TRAFFIC_ALLOWED_ORIGINS=https://flightoverearth.com` in an untracked `.env` (use the exact frontend origin; comma-separate additional origins).
2. Run `docker compose -f compose.traffic.yml up -d --build`. It binds only `127.0.0.1:3001`; configure your HTTPS reverse proxy to forward `/api/traffic` and `/api/traffic/health` to it.
3. Keep **one backend process/replica per OpenSky account**, with the persistent `traffic-budget` volume. Do not delete this volume to reset quota. Multiple independent replicas would each have their own ledger and cache.
4. Set the GitHub Actions repository variable `VITE_TRAFFIC_API_BASE` to that backend origin, e.g. `https://traffic.example.com`, then deploy the frontend workflow. Only this public URL belongs in the Pages build; OpenSky secrets stay on the backend server.
5. Check HTTPS, the origin allowlist, `/api/traffic/health` and a live flight. Behind a reverse proxy the built-in socket-IP request limit applies to the proxy collectively; for a larger public audience add edge request limits and a quota-backed capacity plan.

For a same-origin deployment, reverse-proxy `/api/traffic` alongside the static site and leave `VITE_TRAFFIC_API_BASE` empty. A static Pages site without a configured backend can still use replay. The container and configuration are prepared; this change does not provision or publish a production server.

Implementation plan and validation notes: [OpenSky traffic plan](docs/plan-opensky-ruch-lotniczy.md).

## License

[MIT](LICENSE) – free to use, copy, and modify.
