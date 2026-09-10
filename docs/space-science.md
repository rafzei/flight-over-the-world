# Earth, the Moon and the magnetosphere

The space view uses metres in an Earth-centred equatorial inertial frame, with **+Z toward the north rotation pole**. Rendering may rescale that frame; physical distances do not change. One mean Earth radius, **Rₑ = 6,371 km**, supplies the common scale for the teaching overlay. The detailed surface map still uses the WGS84 ellipsoid.

## Rotation and coordinate conventions

Earth turns eastward: counterclockwise when viewed from above the north pole. The sidereal period is **23 h 56 min 4.09053 s**, angular velocity approximately **7.292115 × 10⁻⁵ rad/s**, rather than a 24-hour solar day. The equatorial surface speed uses the **equatorial** radius of 6,378.137 km, giving **465.1 m/s**; using the mean radius instead gives 464.6 m/s. At latitude φ, the spherical approximation is v(φ) = v_equator cos(φ).

The spin axis is **23.44° from the ecliptic normal**. In an equatorial coordinate frame the spin axis is already +Z; applying this tilt to Earth a second time would be wrong. Solar and lunar directions must be transformed from their orbital/ecliptic coordinates into this equatorial frame. The optional field overlay has a separately tilted **11° schematic magnetic dipole**, which rotates with Earth. Eleven degrees is an educational approximation, not a present-day geomagnetic reference model or a prediction of magnetic-pole locations.

## Distances and regions

All Rₑ values below are **from Earth's centre**. Altitude subtracts one Earth radius. The attachment's early statement that 10–11 Rₑ equals 64,000–70,000 km *above the surface* was inconsistent with its own later table: those are approximately geocentric distances.

| Feature | Distance from centre | Altitude above mean surface | Meaning |
| --- | --- | --- | --- |
| Plasmasphere | Illustrative extent 4.5 Rₑ | About 22,300 km | Relatively cool plasma; the real plasmapause varies. |
| Inner Van Allen belt | Approx. 1.5–3.5 Rₑ | Approx. 3,200–15,900 km | Trapped energetic particles, principally protons. |
| Outer Van Allen belt | Approx. 3–7 Rₑ | Approx. 12,700–38,200 km | Principally energetic electrons; storm-time extents vary. |
| Possible outer-belt extension | Approx. 10 Rₑ | Approx. 57,300 km | Context only; not shown as a permanent third belt. |
| Dayside magnetopause, nominal | 10 Rₑ = 63,710 km | **57,339 km** | Boundary separating plasma regimes. |
| Dayside bow shock, nominal | 14 Rₑ = 89,194 km | **82,823 km** | Incoming solar wind is shocked. |
| Magnetosheath | Between bow shock and magnetopause | Position-dependent | Slowed, heated, compressed, disturbed solar wind. |
| Moon, mean distance | Approx. 60.3 Rₑ = 384,400 km | Approx. 378,000 km | The nightside tail can extend beyond lunar orbit. |
| Magnetotail | Hundreds of Rₑ; extreme extent uncertain | Millions of kilometres | Open, elongated nightside structure. |

The radiation belts are **not** the edge of Earth's magnetic field. Neither is the magnetopause a surface where magnetic field abruptly becomes zero. Interplanetary space contains the solar wind and interplanetary magnetic field. Classifications describe an approximate plasma environment; they are not radiation-dose measurements.

## What the optional overlay models

- A translucent plasmasphere and two toroidal belt envelopes in the tilted magnetic frame; field-line sketches follow ideal-dipole L-shells near Earth. They depict geometry, not a measured particle distribution.
- An independently Sun-oriented, compressed dayside and long, open nightside. The drawing reaches **1,000 Rₑ = 6.371 million km**, an illustrative far-tail extent, not a measured constant, closed end wall or zero-field boundary. Beyond that drawn extent the classifier reports **“Distant tail — extent uncertain”**, rather than asserting that the magnetic field ends.
- A solar-pressure control in **nPa**, nominally 2 nPa. The nose follows r ∝ P⁻¹⁄⁶, from balancing dipole magnetic pressure against solar-wind dynamic pressure. Higher pressure compresses the magnetopause and bow shock. Inputs are bounded to 0.1–30 nPa. This is an explanatory pressure-balance approximation; IMF orientation, reconnection, plasma history, storms and time delays are not simulated.
- Distinct bow-shock and magnetopause surfaces enclose the labelled sheath. Animated tracers travel away from the Sun and divert around this envelope. The reference wind speed is 450 km/s; their **animation is accelerated 100×** to make flow direction visible. Tracers are schematic and do not reproduce a fluid solution.
- Region labels may overlap: a spacecraft can be in both the plasmasphere and a radiation belt. A point at 60 Rₑ on the dayside is in interplanetary solar wind; a point the same distance down the narrow nightside tail may be inside the tail. Spherical distance alone cannot classify these regions.

The default is **overlay off**: these envelopes and tracers are teaching graphics, not features a pilot would see with the naked eye. Toggling the overlay does not apply forces to the rocket or modify aircraft flight.

## Rendering interface

`createMagnetosphereOverlay()` in `src/game/magnetosphere.js` returns `root`, `setVisible`, `update`, `classify`, `diagnostics` and `dispose`.

`update({ sunDirection, siderealTime, time, solarPressure, origin, orientation, metersToWorld })` expects a Sun direction in the equatorial inertial frame, a **sidereal rotation angle in radians**, simulation time in seconds, pressure in nPa, Earth-centre position in the render frame, an inertial-to-render quaternion, and render units per metre. Internal geometry is in Rₑ. A distant scene at 1 unit = 1,000 km uses `metersToWorld: 1e-6`. `classify(positionMeters)` always takes an **inertial position in metres**, regardless of rendering scale.

## Sources and limitations

Read and checked for this implementation:

- [NASA — Earth's Magnetosphere](https://science.nasa.gov/science-research/planetary-science/earths-magnetosphere/): solar-wind deformation, reconnection, dynamic rather than impermeable shielding.
- [NASA — Magnetosphere / Ionosphere](https://science.nasa.gov/heliophysics/focus-areas/magnetosphere-ionosphere/): compressed dayside at roughly 6–10 Earth radii; nightside tail hundreds of Earth radii, beyond the Moon's orbit at about 60 Rₑ. This source supports the long asymmetry; it does not establish a universal 1,000 Rₑ tail length.
- [NASA — What are the Van Allen Belts and why do they matter?](https://science.nasa.gov/biological-physical/stories/van-allen-belts/): trapped-particle belts, radiation exposure during transit, changing belt structure, Apollo lunar flights through the region.
- [NASA — Earth Facts](https://science.nasa.gov/earth/facts/): axial tilt, Earth and Moon scale and context.

The attachment supplies the representative belt ranges and numerical rotation constants. These are deliberately presented as approximate engineering reference values. This implementation is an interactive scientific illustration and a game, not a geomagnetic field solver, flight navigation product, radiation forecast or validated lunar mission design.
