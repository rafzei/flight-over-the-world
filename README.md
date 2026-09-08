# Flight Over the Earth

Fly over photorealistic Earth – guess the region, find your way home, or just explore. Single player and multiplayer.

**Play:** https://flightoverearth.com — the public Cesium ion quota is used up, so the hosted site needs your own [Cesium ion](https://ion.cesium.com/) token (paste it on the start screen, or put it in `.env` locally).

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

## Vehicles

Seven vehicles are available in single player and multiplayer:

| Vehicle | Cruise / max speed | Flight characteristics and features |
| --- | --- | --- |
| **Piper PA-28** | ~170 / 470 km/h | Light propeller aircraft with animated propeller. |
| **Dash 8 Q400** | ~270 / 670 km/h | Regional turboprop with two animated propellers. |
| **Cessna Citation** | ~330 / 900 km/h | Business jet. |
| **Fighter** | ~540 / 1510 km/h | Combat jet with moving control surfaces, navigation lights, launchable missiles and wingtip contrails above 1000 km/h. |
| **Rocket** | ~790 / 5000 km/h | Forward-flying rocket with trails from four fins; engine fire appears above 5000 km/h. |
| **Combat Drone** | 120 / 320 km/h | Armed quadrotor replacing Rocket 1, with four spinning rotors, two gun pods, a camera and red lights. Independent lift and automatic braking; cutting throttle makes it descend under gravity. |
| **SpaceX Falcon 9** | Thrust-controlled / 8000 km/h | Upright rocket with nine engine nozzles, steering, gravity and inertia. Press `Enter` to release the Dragon capsule; its red-and-white parachute opens after separation. |

Speeds are game settings, not real-world specifications. Aircraft and the original Rocket can exceed their nominal maximum in a dive. Falcon 9 starts upright with zero speed and accelerates under engine thrust.

The drone uses `A` / `D` to turn, even at zero forward speed, and `W` / `S` to descend / climb while powered. Its throttle controls horizontal speed and rotor lift: at zero throttle it brakes and falls towards the ground; adding power restores altitude control. Falcon 9 uses `W` / `S` to tilt and `A` / `D` to turn; throttle controls thrust, so cutting it lets gravity pull the rocket down. The released Dragon descends separately while you continue controlling Falcon 9. The on-screen **Release Dragon** button also works on touch devices.

## Flight features

- Speed-sensitive controls for smoother steering at high speed.
- Vehicle shadows on nearby terrain and buildings, softening and fading out by 180 m above the surface.
- Four camera views: chase, 3× farther, 5× farther and nose view; Falcon 9's nose camera points up its body axis.
- Full-screen map in free flight with mouse-wheel, `+` / `−` and pinch zoom. Zoom is remembered when reopening the map.
- Mouse-wheel throttle control anywhere in flight, plus a draggable throttle and touch flight stick.
- Contrails that follow the flight path, spread, drift and fade over time.
- Fighter missiles: press `Enter` to launch from alternating wing stations. Aim with the aircraft; missiles explode on terrain or building impact, with fire, smoke and sound. Each of the four stations reloads after 4 seconds. Launches are shared in multiplayer; a **Fire missile** button is available for touch controls.
- Multiplayer vehicle selection, player list and push-to-talk voice chat.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrow keys | Fly; drone and Falcon 9 controls are described above |
| Mouse wheel / drag throttle | Change throttle without selecting the slider first |
| `Shift` | Boost |
| `Ctrl` | Brake |
| `,` | Set minimum throttle |
| `.` | Set maximum throttle |
| `C` | Cycle camera: chase → 3× farther → 5× farther → nose view → fixed tracking → front |
| `M` | Open / close the map in free flight |
| Mouse wheel / `+` / `−` / pinch over the map | Zoom the map |
| `Enter` | Fighter: launch a missile; Falcon 9: release Dragon once per flight |
| `Tab` | Show multiplayer player list (hold) |
| `T` | Talk (hold) |
| `Esc` | Close map, pause single player, or open the multiplayer leave menu |
| `R` | Restart after a crash or finished flight |

Fixed tracking keeps the camera at its current location and turns it toward
the flying vehicle. The next `C` switches to an external front view that follows
the vehicle and looks back at it. Press `C` once more to return to normal chase.

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

Node.js 18+ and a free [Cesium ion](https://ion.cesium.com/) token.

```bash
git clone https://github.com/bartosz-ciesielski/flight-over-the-world.git
cd flight-over-the-world
npm install
cp .env.example .env
```

1. Create an account at [ion.cesium.com](https://ion.cesium.com/).
2. Create a token (Access tokens).
3. In My Assets add **Google Photorealistic 3D Tiles** (asset `2275207`).
4. Put one or more tokens in `.env` as `VITE_CESIUM_ION_KEYS=token1,token2,token3`.
5. For production, set the same comma-separated list as the GitHub secret `VITE_CESIUM_ION_KEYS`.

Use a separate Cesium ion account per token. On HTTP 429 the game keeps high tile quality and switches to the next key, then retries the tiles that failed. One key still works; more keys keep the map sharp under load.

```bash
npm run dev
```

Open the address from the terminal (usually `http://localhost:5173`). In multiplayer one player clicks Multiplayer, the other opens the copied link.

Do not commit the key – `.env` is in `.gitignore`. Tiles do not load in the menu, only after you start a flight.

## License

[MIT](LICENSE) – free to use, copy, and modify.
