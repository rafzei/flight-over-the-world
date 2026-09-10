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
- **Free flight** – pick a city and fly. Land on paved runways across Poland without changing modes; the game detects the runway and approach direction automatically.
- **Land** – choose an airport and runway direction from the Polish catalogue (64 airports, 68 runways). Start 6 km before the threshold, aligned with a 3° approach and landing gear down. Available for Piper, Q400, Citation, Boeing 737, Airbus A320 and Fighter. Choose a light aircraft for short or narrow strips.

## Vehicles

Nine vehicles are available in single player and multiplayer:

| Vehicle | Cruise / max speed | Flight characteristics and features |
| --- | --- | --- |
| **Piper PA-28** | ~170 / 470 km/h | Light propeller aircraft with animated propeller, authored surface panels, refined glazing and navigation lights. |
| **Sailplane** | ~100 km/h trim / 270 km/h dive limit | Unpowered 18 m glider with tapered wings, a glazed canopy, T-tail, fixed central and tail wheels, animated airbrakes and wind sound. |
| **Dash 8 Q400** | ~270 / 670 km/h | Regional turboprop with two animated propellers, cabin windows, panel seams and navigation lights. |
| **Cessna Citation** | ~330 / 900 km/h | Business jet with refined glazing, metal surfaces and navigation lights. |
| **Boeing 737-800** | ~830 / 970 km/h | Original twin-engine airliner with framed cockpit panes, doors, cargo hatches, fan blades, flattened nacelles, wing panels and blue livery. |
| **Airbus A320** | ~810 / 950 km/h | Original twin-engine airliner with framed cockpit panes, doors, cargo hatches, fan blades, wing panels and teal livery. |
| **Fighter** | ~540 / 1510 km/h | Combat jet with moving control surfaces, navigation lights, launchable missiles and wingtip contrails above 1000 km/h. |
| **Rocket** | Thrust-controlled; no fixed speed cap | Steerable spacecraft with vacuum inertia, variable gravity and assisted Earth–Moon travel. Engine exhaust follows thrust. |
| **Combat Drone** | 120 / 320 km/h | Armed quadrotor replacing Rocket 1, with four spinning rotors, two rotating cannons firing 360° bursts, a camera and red lights. Independent lift and automatic braking; cutting throttle makes it descend under gravity. |
| **SpaceX Falcon 9** | Thrust-controlled; no fixed speed cap | Upright game spacecraft with nine engine nozzles and assisted Earth–Moon travel. Press `Enter` below 80 km Earth altitude to release Dragon with its red-and-white parachute. |

Aircraft speeds are game settings, not real-world specifications. Aircraft can exceed their nominal maximum in a dive. Both rockets inherit Earth's eastward surface velocity and accelerate under thrust; the HUD uses speed relative to Earth near the launch site. In space, the flight panel identifies the distance and speed relative to the Moon.

The sailplane starts airborne and gradually descends. `W` lowers the nose to gain speed; `S` trades speed for height, with a stall and descent if held too long. `A` / `D` bank and turn. The **AIRBRK** slider (or mouse wheel) controls aerodynamic brakes: `Ctrl` temporarily extends them, `Shift` retracts them, and `,` / `.` set retracted / fully extended. There is no engine or boost. Airbrakes steepen the descent; use `B` for wheel braking after touchdown. The glider supports **Land**, free flight and multiplayer; restart for another flight after stopping. This simplified model has no thermals or tow launch.

The drone uses `A` / `D` to turn, even at zero forward speed, and `W` / `S` to descend / climb while powered. Its throttle controls horizontal speed and rotor lift: at zero throttle it brakes and falls towards the ground; adding power restores altitude control. Falcon 9 uses `W` / `S` to tilt and `A` / `D` to turn; throttle controls thrust, so cutting it lets gravity pull the rocket down. The released Dragon descends separately while you continue controlling Falcon 9. The on-screen **Release Dragon** button also works on touch devices.

## Earth–Moon flight

Choose **Single player → Free flight → Rocket or SpaceX Falcon 9**, enter a city and start. **Fly to Moon** engages guidance from your current position. Select **1000×** to accelerate the journey; the panel shows the effective rate, which automatically drops near either surface. **Stop guidance** returns to manual thrust and steering at 1×. `Esc` pauses the flight.

Guidance performs a powered ascent, curves around Earth when necessary, tracks the moving Moon and brakes for touchdown. Both rockets can reach and remain on the lunar surface. Their position changes through integrated velocity and acceleration, with Earth and lunar gravity and no fixed vacuum speed cap. The nominal Earth–Moon centre distance is **384,400 km**; a typical assisted Warsaw mission takes about **9.5 simulated hours**, or a few minutes at the selected time acceleration. Near touchdown the last kilometre runs at normal speed.

**Space map** shows Earth, the Moon and the rocket in the same distance scale. Drag to orbit, scroll to zoom, and use `Esc` or **Return to flight** to return. `M` opens this view above 100 km in Free flight. Earth rotates once per sidereal day, with a 23.44° tilted axis in the overview. The ship marker and text labels are enlarged for legibility. **Magnetosphere & flight model** enables the optional field illustration and its solar-wind pressure control. [Scientific assumptions and references](docs/space-science.md) distinguish altitude from distance measured from Earth's centre.

These are **assisted game spacecraft with unlimited propellant**, including the Falcon-shaped vehicle. Fuel, staging, life support, radiation damage, return-to-Earth guidance and a real Falcon lunar mission profile are not simulated. The Moon follows a mean circular inclined orbit and a mission-relative clock, with an illustrative initial Sun phase, rather than the current UTC ephemeris. The surface is spherical; the imagery does not provide crater elevation or local terrain relief. Dragon's atmospheric parachute is available only below 80 km above Earth.

Detailed Earth tiles and OpenSky polling stop during deep-space flight. Near objects remain in metres; distant bodies use a separate scaled render scene and individual depth passes to keep both the ship and the Moon stable at large distances. Aircraft and airport landing dynamics continue to use the existing Earth scene. B738/A320 share their detailed six-part geometry between player, menu and instanced traffic models.

Imagery: [Moon LROC colour map](https://svs.gsfc.nasa.gov/4720/) — NASA/GSFC/Arizona State University; [Earth Blue Marble texture distributed with Three.js r170](https://github.com/mrdoob/three.js/blob/r170/examples/textures/planets/earth_atmos_2048.jpg) — NASA imagery derivative. The bundled 2048-pixel maps are for the globe view, not ground-resolution photography.

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

## Landing in Poland

Choose **Single player → Land**, select the airport and runway direction, then **Start** for a prepared approach. Alternatively, fly to an airport in **Free flight** and extend the gear with `G`. The same landing physics and instruments work in both modes. Follow the runway centreline and the landing panel's target speed, descent rate and glide-path error. Where the threshold is displaced from the physical start of the pavement, touch down beyond its stripes, near the paired aiming-point blocks. Both runway directions work, and the panel identifies the active airport and runway.

Keep the wings level, reduce throttle near the runway and gently pull back with `S` to flare. The main wheels must touch first, with a small nose-up attitude and a low descent rate. After touchdown, let the nose settle, press `,` for idle and hold `B` to stop. `A` / `D` steer on the ground; sharp turns at speed can cause a runway excursion. For another takeoff, release the brakes, press `.` for full power and pull back after accelerating above approach speed. Gear and wheel-brake buttons also support touch input.

The aircraft rests on its wheels, with animated retractable gear, wheel rotation and suspension compression. Excessive sink can cause a bounce or gear failure; a belly landing, nose-first impact, wing strike or departure from the pavement ends the flight. `R` restarts the approach after a crash. Landing gear cannot retract while on the ground.

This is a simplified game flight model with descent inertia, flare, rollout drag and wheel braking. It is not a training simulator. The offline catalogue combines OurAirports with © OpenStreetMap contributors, excluding closed airports, closed runways and grass surfaces. It includes passenger airports, military airfields and smaller paved strips. The catalogue is a data snapshot, not live operational or NOTAM information. See [the airport list, sources, exceptions and update procedure](docs/polish-airports.md).

Runways render within approximately 35 km of the player and release their graphics resources when left behind. The visible pavement and both landing directions share one physical plane. Its elevation and slope are calibrated from map terrain while the aircraft is safely airborne, then held fixed near touchdown and during rollout. Outside the pavement, terrain impacts retain the existing crash behavior. Landing uses no OpenSky requests; tests can run with **Live traffic** off.

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
