# SpaceX Falcon Heavy — research and game model

Researched on 11 September 2026. The model is original procedural geometry; SpaceX photographs are references, not shipped textures.

## Primary sources inspected

1. [SpaceX — Falcon Heavy](https://www.spacex.com/vehicles/falcon-heavy/): overview, first stage, engines, landing legs, interstage, second stage and payload panels. The current site serves these panels through its application; the displayed content was read from that application.
2. [Falcon User's Guide, 9 May 2025](https://sxcontent9668.azureedge.us/cms-assets/assets/falcon-users-guide-2025-05-09.pdf): §§2.2–2.6, printed pages 6–10 (PDF pages 17–21), table 2-1 and figure 2-3. Figure 2-3 was rendered and visually inspected to check all three Octaweb engine groups.
3. [Official full vehicle render](https://www.spacex.com/assets/images/vehicles/falcon-heavy/mobile/WebsiteFHFairings_Render_Mobile.jpg): visually inspected for relative tank lengths, rounded side noses, the widened payload fairing, raceways, folded fins and legs.
4. [Official launch photograph, FH_3](https://www.spacex.com/assets/images/vehicles/falcon-heavy/FH_3.jpg): visually inspected for the three parallel cores, actual separation between them, dark lower hardware, external pipes and the combined exhaust. This photograph shows an earlier finish; the model uses a dark central interstage resembling later Block 5 hardware.

## Verified structure and dimensions

| Feature | Published reference | Model treatment |
| --- | --- | --- |
| Overall height, standard fairing | 70 m | 70 m normalized playable model |
| Overall width | 12.2 m | Core axes at −4.27, 0, +4.27 m; tank diameter 3.66 m, small fittings project beyond the nominal envelope |
| Core / second-stage diameter | 3.66 m | Three equal 1.83 m radius tank barrels and a matching upper stage |
| Standard fairing | 13.1 m high, 5.2 m diameter | Two independently detachable curved shells |
| First-stage engines | 27 Merlin 1D: nine per core | Each group has eight surrounding one central bell; hollow nozzles with metal rims |
| Second-stage engine | One Merlin Vacuum | A wide vacuum bell becomes visible after center-core separation |
| Recovery equipment | Four grid fins and four legs per core | Twelve lattice fins, twelve hinged legs with struts and level feet |
| Propellants | LOX and RP-1 | Appearance only; fuel consumption is not simulated |
| Side-core attachment | Forward and aft pneumatic pushers | Visible upper and lower connection hardware, outward separation impulse |

The website lists 24,681 kN first-stage thrust and 981 kN for the vacuum engine. The guide's first-stage narrative lists 22,819 kN, and its table also differs slightly from its narrative. These are published configuration/rating differences or inconsistencies; the game does not claim to reproduce either exact thrust curve. Website payload ratings (63,800 kg LEO, 26,700 kg GTO, 16,800 kg Mars) are launch capability references, not payloads or mission promises in this game.

## Visual decisions

White aluminum-lithium tank barrels dominate the silhouette. The center core continues through a dark composite interstage into a narrower upper-stage tank and a widened, ogive-shaped white fairing. Side boosters terminate in individual rounded nosecones. Dark landing legs fold upward against the lower tanks; folded metal grid fins sit near each core's top. Fine circumferential joints, external cable covers, service ports, US flags and procedural SpaceX/Falcon Heavy lettering provide close-view detail. Small hardware dimensions and individual stage lengths are approximated from the inspected imagery; this is not engineering CAD.

The playable model represents a recovery-equipped vehicle. Hardware and recovery profiles vary by real mission, and an expendable center stage is also used in actual flights.

## Cabin and gameplay departures

**An operational crew cabin on Falcon Heavy is not established by these references.** The real standard silhouette carries a payload fairing; Dragon crew missions use Falcon 9. To satisfy the requested detachable cabin while preserving the recognizable Heavy silhouette, this game puts a fictional Dragon-inspired cabin inside the fairing. Both the vehicle description and touch instructions label this as a game variant. Releasing it ejects both fairing halves and deploys a parachute after separation.

Controls follow the existing Falcon 9 convention:

- Double `Enter` within 300 ms: detach both side boosters simultaneously; the next double press detaches the center core. Touch uses the same guarded action through the staging button.
- Single `Enter`: eject the cabin and both fairing halves; the capsule descends under its own parachute. The controlled vehicle remains the rocket/upper stage.
- Staging is available from 60 m above local ground to 150 km altitude. Cabin release is available below 80 km above Earth, where the game's parachute model is used.

Each booster inherits launch velocity and attitude. Side boosters receive opposite outward impulses and terrain-probed targets 130 m apart; the center has a separate target. Recovery uses the existing assisted integrated physics, grid-fin animation, landing burns and leg deployment. It uses unlimited propellant and local gravity; it is not a real RTLS/drone-ship mission simulation. Fairing pieces drift and tumble for 20 seconds, then disappear; fairing recovery is not simulated. Space travel and lunar guidance use the existing assisted game spacecraft controller.

All detached cores are included in multiplayer snapshots. Pause freezes their integrated motion. Reset, vehicle switching and disposal restore or clean up cores, fairings, cabin, parachute, shadows and exhaust.

## Validation

Automated coverage checks sequential staging and pose continuity at Earth-scale coordinates, independent targets, 30/144 FPS soft landings with all twelve soles touching terrain, pause/reset, cabin release before/after either staging event, exhaust ownership, nested multiplayer validation and late-join synchronization. Existing Falcon 9 tests continue to cover its original behavior.

Local browser checks also exercised vehicle selection, double-Enter side separation, the center-core button, single-Enter cabin release, desktop and 390 px mobile layouts, plus intact and exploded studio renders. No JavaScript or WebGL errors were reported. These checks used local assets with external traffic/terrain requests blocked; terrain touchdown is separately covered against actual Three.js geometry in the automated tests.
