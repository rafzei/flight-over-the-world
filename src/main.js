import {
  WGS84_ELLIPSOID,
  CAMERA_FRAME,
  TilesRenderer,
} from "3d-tiles-renderer";
import {
  TilesFadePlugin,
  UpdateOnChangePlugin,
  UnloadTilesPlugin,
  TileCompressionPlugin,
  GLTFExtensionsPlugin,
  GoogleCloudAuthPlugin,
  CesiumIonAuthPlugin,
} from "3d-tiles-renderer/plugins";
import {
  Scene,
  WebGLRenderer,
  PerspectiveCamera,
  HemisphereLight,
  DirectionalLight,
  Raycaster,
  Vector3,
  Matrix4,
  Color,
  Clock,
  FogExp2,
  Quaternion,
  TextureLoader,
  EquirectangularReflectionMapping,
  SRGBColorSpace,
  LinearFilter,
  LinearMipmapLinearFilter,
  Box3,
  Group,
  Mesh,
  MeshBasicMaterial,
  ConeGeometry,
  CylinderGeometry,
} from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { loadVehicleModel, disposeModelResources } from "./game/vehicleModels.js";
import { createCombatDrone, updateCombatDrone } from "./game/combatDrone.js";
import { createFighterMissiles } from "./game/fighterMissiles.js";
import { createDroneCannons } from "./game/droneCannons.js";
import { setLoader, hideLoader } from "./game/hud.js";
import { createPlaneMesh } from "./game/plane.js";
import { createVehicleController } from "./game/vehicleControllers.js";
import { SAILPLANE_SPEC, updateSailplane } from "./game/sailplane.js";
import { BALLOON_SPEC, updateBalloon } from "./game/balloon.js";
import { GrassFields } from "./game/grassFields.js";
import { GrassLanding, checkTowPath } from "./game/grassLanding.js";
import { SailplaneTow, TowVisuals, parseTowSnapshot } from "./game/sailplaneTow.js";
import { createFalcon9, falconState, releaseDragon, resetDragon, resetFalcon9, updateDragon,
  releaseBooster, updateBooster, boosterSnapshot, parseBoosterSnapshot, syncBooster } from "./game/falcon9.js";
import { FalconStageInput } from "./game/boosterRecovery.js";
import { FlightCamera, FLIGHT_CAMERAS } from "./game/flightCamera.js";
import { applyRotorState, spinRotors } from "./game/rotors.js";
import {
  attachRocketExhaust,
  updateRocketExhaust,
  disposeRocketExhaust,
} from "./game/rocketExhaust.js";
import { attachContrails, updateContrails, disposeContrails } from "./game/contrails.js";
import { finishVehicleMaterials, prepareFighterSurfaces, updateFighterSurfaces, disposeVehicleVisuals } from "./game/vehicleVisuals.js";
import { createVehicleGroundShadows } from "./game/vehicleGroundShadows.js";
import { createVehicleCollisionDetector, raycastTerrain } from "./game/vehicleCollision.js";
import { createCarousel } from "./game/menuPreview.js";
import { createSky } from "./game/sky.js";
import { solarPosition, localSolarState, createTerrainDayNight } from "./game/dayNight.js";
import { createFlightClock } from "./game/flightClock.js";
import { SpaceScene, SPACE_RENDER_SCALE } from "./game/spaceScene.js";
import { SPACE_CONSTANTS, moonPositionECEF } from "./game/spacePhysics.js";
import { createMagnetosphereOverlay, classifySpaceEnvironment } from "./game/magnetosphere.js";
import { createAirliner } from "./game/airliner.js";
import { AirportRunways, DEFAULT_APPROACH } from "./game/airportRunways.js";
import { attachLandingGear, LANDING_SPEEDS } from "./game/landingGear.js";
import { LandingSystem, flightPose } from "./game/landingDynamics.js";
import {
  drawAirspeed,
  drawAltimeter,
  drawCompass,
} from "./game/instruments.js";
import { asset } from "./game/asset.js";
import {
  createExplosion,
  playExplosionSound,
  primeAudio,
} from "./game/explosion.js";
import { updateEngineSound, engineDebug } from "./game/engineSound.js";
import {
  updateMusic,
  primeMusic,
  musicDebug,
  musicEnabled,
  setMusicEnabled,
  setMusicSuspended,
} from "./game/music.js";
import {
  TileKeyPool,
  loadTileSlots,
  syncTileAuth,
  applyTileQuality,
  PUBLIC_MAP_LOCKED,
  getUserIonKey,
  setUserIonKey,
} from "./game/tileAuth.js";
import { createHoldParentTilesPlugin } from "./game/holdParentTiles.js";
import { createFreeMap, createMiniMap, paintTrailMap } from "./game/freeMap.js";
import { createLiveTraffic } from "./game/liveTraffic.js";
import { earthPosition } from "./game/trafficVisibility.js";

// rakieta stoi pionowo (+Y) — połóż ją nosem do przodu (-Z, konwencja lotu)
function prepareRocket(model) {
  model.rotation.x = -Math.PI / 2;
  return model;
}

// myśliwiec w GLB ma nos w +Z, a lot idzie w -Z
function prepareJet(model) {
  model.rotation.y = Math.PI;
  prepareFighterSurfaces(model);
  return model;
}
import {
  distanceM,
  offsetPoint,
  createBeacon,
  pickGuessStart,
  drawPolandMap,
  loadCountryGeo,
  loadContinentGeo,
  unprojectCountry,
  unprojectContinent,
  drawEuropeMap,
  loadWorldGeo,
  drawWorldMap,
  unprojectWorld,
  loadEuropeGeo,
} from "./game/modes.js";
import {
  detectLocale,
  getRegionPack,
  setRegionPack,
  regionPayload,
  guessHoldAlt,
} from "./game/regions.js";
import {
  parseRoomFromUrl,
  roomLink,
  setRoomUrl,
  hostRoom,
  joinRoom,
  wasHosting,
  rememberHost,
} from "./game/net.js";
import {
  bindVoice,
  ensureMic,
  setTalking,
  isTalking,
  voiceDenied,
  answerCall,
  syncVoiceCalls,
  dropVoicePeer,
  destroyVoice,
} from "./game/voice.js";

// zakresy trybu "Zgadnij region"
const GUESS_SCOPES = {
  pl: {
    load: loadCountryGeo,
    draw: drawPolandMap,
    unproject: unprojectCountry,
    sub: "Click a point on the map of Poland",
    status: "Picking a point in Poland…",
  },
  eu: {
    load: loadContinentGeo,
    draw: drawEuropeMap,
    unproject: unprojectContinent,
    sub: "Click a point on the map of Europe",
    status: "Picking a point in Europe…",
  },
  world: {
    load: loadWorldGeo,
    draw: drawWorldMap,
    unproject: unprojectWorld,
    sub: "Click a point on the world map",
    status: "Picking a point somewhere on Earth…",
  },
};

const tilePool = new TileKeyPool(loadTileSlots());
const TERRAIN_ALT = 120; // przybliżona wysokość elipsoidalna nizin

// Google wyłączyło Photorealistic 3D Tiles dla kont billingowych z EEA (403).
// Obejście: darmowe konto Cesium ion — serwuje te same kafelki Google
// (asset 2275207), plugin sam pobiera brokerowany token i odnawia go co 3 h.
const ION_GOOGLE_TILES_ASSET = "2275207";

const PLANES = {
  balloon: BALLOON_SPEC,
  sailplane: SAILPLANE_SPEC,
  pa28: {
    file: asset("models/pa28.glb"),
    wingspan: 11,
    cruise: 48,
    boost: 130,
    brake: 30,
    cam: [0, 5.5, 15],
    name: "Piper PA-28",
    desc: "Light propeller – cruise 170, max 470 km/h",
    sound: "plane",
  },
  q400: {
    file: asset("models/q400.glb"),
    wingspan: 28,
    cruise: 75,
    boost: 185,
    brake: 45,
    cam: [0, 9, 32],
    name: "Dash 8 Q400",
    desc: "Regional turboprop – cruise 270, max 670 km/h",
    sound: "plane",
  },
  citation: {
    file: asset("models/citation.glb"),
    wingspan: 16,
    cruise: 92,
    boost: 250,
    brake: 55,
    cam: [0, 7, 24],
    name: "Cessna Citation",
    desc: "Business jet – cruise 330, max 900 km/h",
    sound: "jet",
  },
  b738: {
    create: () => createAirliner("b738"), wingspan: 39.47,
    cruise: 230, boost: 270, brake: 70, cam: [0, 12, 56],
    name: "Boeing 737-800", desc: "Twin-engine airliner – cruise 830, max 970 km/h", sound: "jet",
  },
  a320: {
    create: () => createAirliner("a320"), wingspan: 37.57,
    cruise: 225, boost: 265, brake: 68, cam: [0, 12, 54],
    name: "Airbus A320", desc: "Twin-engine airliner – cruise 810, max 950 km/h", sound: "jet",
  },
  jet: {
    file: asset("models/jet.glb"),
    wingspan: 10,
    cruise: 150,
    boost: 420,
    brake: 80,
    cam: [0, 6, 19],
    name: "Fighter",
    desc: "Combat jet – cruise 540, max 1510 km/h",
    sound: "jet",
    prepare: prepareJet,
  },
  rocket: {
    file: asset("models/rocket.glb"),
    wingspan: 12,
    cruise: 220,
    boost: 5000 / 3.6,
    brake: 120,
    cam: [0, 6, 20],
    name: "Rocket",
    desc: "Fast aircraft – cruise 790, max 5000 km/h",
    sound: "rocket",
    contrailOptions: { wingAxes: ["x", "y"] },
    exhaust: true,
    prepare: prepareRocket,
    flightModel: "plane",
  },
  drone: {
    create: createCombatDrone,
    wingspan: 8,
    cruise: 120 / 3.6,
    boost: 320 / 3.6,
    brake: 0,
    cam: [0, 4, 12],
    name: "Combat Drone",
    desc: "Armed quadrotor – descends at idle, cruise 120, max 320 km/h",
    sound: "drone",
    flightModel: "drone",
  },
  falcon9: {
    create: createFalcon9,
    wingspan: 38,
    cruise: 300 / 3.6,
    boost: 8000 / 3.6,
    brake: 0,
    cam: [0, 9, 43],
    name: "SpaceX Falcon 9",
    desc: "Earth–Moon game flight · assisted guidance · Dragon parachute below 80 km",
    sound: "rocket",
    flightModel: "lunar",
    vertical: true,
    exhaust: true,
    exhaustOptions: { axis: "y", ignitionKmh: 0 },
  },
};
const PLANE_ORDER = ["pa28", "sailplane", "q400", "citation", "b738", "a320", "jet", "rocket", "drone", "falcon9", "balloon"];

const HOME_TIME = 600; // 10 min na dolot do domu
const GUESS_TIME = 60; // 1 min na rozpoznanie terenu
const MARK_TIME = 10;
const RESULTS_TIME = 10;
const HOME_CAPTURE_M = 600;
const HOME_BEACON_M = 1000;

let camera, scene, renderer, tiles, sun, sky, ambientLight;
let spaceScene, magnetosphere;
let solarPressure = 2;
const spaceMoon = new Vector3(), spaceSun = new Vector3(), spaceObserver = new Vector3();
const physicalSunWorld = new Vector3();
const earthCentreWorld = new Vector3();
const terrainDayNight = createTerrainDayNight();
const flightClock = createFlightClock(document.getElementById('flight-clock'));
let solar = solarPosition(), localSun;
let spaceTime = 0;
let liveTraffic;
const airportRunways = new AirportRunways();
let selectedApproach = DEFAULT_APPROACH;
const landingSystem = new LandingSystem(airportRunways.get(selectedApproach));
const grassFields = new GrassFields();
const grassLanding = new GrassLanding(grassFields);
const sailplaneTow = new SailplaneTow();
let landingBrake = false;
let vehicleGroundShadows;
let fighterMissiles;
let droneCannons;
const falconStageInput = new FalconStageInput({ single: deployDragon, double: deployBooster });
let missileShotSeq = 0;
const lastMissileShotSeq = new Map();
let droneBurstSeq = 0;
const lastDroneBurstSeq = new Map();
const shadowUp = new Vector3();
const shadowSunDirection = new Vector3();
let tile429Count = 0;
let lastFailedRetryAt = 0;
let lastTileErr = "";
let pendingFailedRetry = false;

function onTileThrottle(status = 429) {
  tile429Count += 1;
  lastTileErr = String(status);
  pendingFailedRetry = true;
  lastFailedRetryAt = performance.now();
  tilePool.rotate(status);
}

function retryFailedTiles(force = false) {
  if (!tiles) return;
  const failed = tiles.stats?.failed || 0;
  const rootDead = tiles.rootLoadingState === -1;
  if (!force && !pendingFailedRetry && !failed && !rootDead) return;
  const now = performance.now();
  const wait = tile429Count || rootDead ? 8000 : 1500;
  if (!force && now - lastFailedRetryAt < wait) return;
  lastFailedRetryAt = now;
  pendingFailedRetry = false;
  resetFailedTilesSafe();
}

function resetFailedTilesSafe() {
  if (!tiles) return;
  try {
    tiles.resetFailedTiles?.();
  } catch (err) {
    lastTileErr = String(err?.message || err).slice(0, 220);
  }
}

function updateTilesSafe() {
  if (!tiles) return;
  try {
    tiles.update();
  } catch (err) {
    lastTileErr = String(err?.message || err).slice(0, 220);
    pendingFailedRetry = true;
  }
}
let planeMesh, plane, beacon;
let groundAlt = TERRAIN_ALT;
let crashed = false;
let finished = false;
let loaderDismissed = false;
let gameReady = false;
const isMobile =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && matchMedia("(pointer: coarse)").matches));
const START_FLAG = "fotw_starting";
const LAST_ERR = "fotw_lasterr";
function markStarting() {
  try {
    sessionStorage.setItem(START_FLAG, String(Date.now()));
  } catch {
    /* ignore */
  }
}
function clearStarting() {
  try {
    sessionStorage.removeItem(START_FLAG);
  } catch {
    /* ignore */
  }
}
function rememberError(msg) {
  try {
    sessionStorage.setItem(LAST_ERR, String(msg || "").slice(0, 280));
  } catch {
    /* ignore */
  }
}
function lastError() {
  try {
    return sessionStorage.getItem(LAST_ERR) || "";
  } catch {
    return "";
  }
}
function clearError() {
  try {
    sessionStorage.removeItem(LAST_ERR);
  } catch {
    /* ignore */
  }
}
const liteMode = isMobile;
if (liteMode) document.body.classList.add("lite");
let loadError = null;
let frameCount = 0;
let selectedPlane = "pa28";
let menuOpen = true;
let paused = false;
let leaveOpen = false;
let pendingSnap = false; // po teleporcie: jednorazowe dosadzenie na właściwą wysokość
let crashGraceUntil = 0;
let startLat = 52.38871,
  startLon = 16.60069; // Niepruszewo
let camOffset = PLANES.pa28.cam;

// tryby gry
let mode = "free"; // free | home | guess
let homeTarget = null;
const homePath = [];
let timeLeft = 0;
let timerActive = false;
let guessOpen = false;
let guessAnswered = false;
let guessScope = "pl"; // pl | world
let awaitingSnap = false; // guess: menu/overlay czeka na pomiar terenu, start od razu na ~350 m
let awaitingSnapSince = 0;
let snapLastGh = null; // dosadzenie dopiero gdy pomiar terenu się ustabilizuje (kafelki się doprecyzują)
let snapBestGh = null; // najwyższa zmierzona powierzchnia — nie wracamy pod LOD-parent
let snapStableCount = 0;
let snapFirstAt = 0;
let lastSurf = null;
let geoCache = null;
let geoCacheScope = null;
let geoLoadId = 0;
let beaconGrounded = false;
const explosions = [];
let shake = 0;
const matePos = new Vector3();
const mateQuat = new Quaternion();
const mateScale = new Vector3();
const mateUp = new Vector3();
const MATE_MARKER_MS = 10000;
const MATE_INTERP_MS = 130;
const MATE_SEND_MS = 40;
const PLAYER_COLORS = [
  "#7ec8e3",
  "#e37e7e",
  "#9dce6a",
  "#d4a5f5",
  "#f0c36e",
  "#6ec8c1",
];
const NAME_ADJ = [
  "Swift",
  "Silent",
  "Red",
  "Night",
  "Wild",
  "White",
  "Golden",
  "Sky",
  "Sharp",
  "Storm",
  "Keen",
  "Bold",
];
const NAME_NOUN = [
  "Eagle",
  "Falcon",
  "Wolf",
  "Fox",
  "Hawk",
  "Lynx",
  "Raven",
  "Badger",
  "Gnat",
  "Stag",
  "Puma",
  "Shark",
];

function randomUsername() {
  const a = NAME_ADJ[Math.floor(Math.random() * NAME_ADJ.length)];
  const n = NAME_NOUN[Math.floor(Math.random() * NAME_NOUN.length)];
  return `${a} ${n}`;
}

const NICK_KEY = "foe-nick";
const JOIN_KEY = "foe-join";
const GUESS_STATS_KEY = "foe-guess-stats";
let pendingJoinId = "";
let helloTimer = 0;
let welcomed = false;

function loadGuessStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(GUESS_STATS_KEY) || "");
    const n = Number(raw?.n) || 0;
    const sum = Number(raw?.sum) || 0;
    const min = Number(raw?.min);
    const max = Number(raw?.max);
    if (n > 0 && Number.isFinite(sum)) {
      return {
        n,
        sum,
        min: Number.isFinite(min) ? min : Infinity,
        max: Number.isFinite(max) ? max : 0,
      };
    }
  } catch {
    /* ignore */
  }
  return { n: 0, sum: 0, min: Infinity, max: 0 };
}

let guessStats = loadGuessStats();

function storeGuessStats() {
  try {
    localStorage.setItem(
      GUESS_STATS_KEY,
      JSON.stringify({
        n: guessStats.n,
        sum: guessStats.sum,
        min: Number.isFinite(guessStats.min) ? guessStats.min : 0,
        max: guessStats.max,
      })
    );
  } catch {
    /* ignore */
  }
}

function fmtGuessKm(km) {
  if (!Number.isFinite(km)) return "–";
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

function recordSoloGuess(errKm) {
  if (!Number.isFinite(errKm) || errKm < 0) return;
  guessStats.n += 1;
  guessStats.sum += errKm;
  guessStats.min = Math.min(guessStats.min, errKm);
  guessStats.max = Math.max(guessStats.max, errKm);
  storeGuessStats();
  renderGuessStats();
}

function renderGuessStats() {
  if (!guessStats.n) {
    if (el.gmAvg) el.gmAvg.textContent = "–";
    if (el.gmMin) el.gmMin.textContent = "–";
    if (el.gmMax) el.gmMax.textContent = "–";
    if (el.gmStatsN) el.gmStatsN.textContent = "No guesses yet";
    return;
  }
  if (el.gmAvg)
    el.gmAvg.textContent = fmtGuessKm(guessStats.sum / guessStats.n);
  if (el.gmMin) el.gmMin.textContent = fmtGuessKm(guessStats.min);
  if (el.gmMax) el.gmMax.textContent = fmtGuessKm(guessStats.max);
  if (el.gmStatsN)
    el.gmStatsN.textContent =
      guessStats.n === 1 ? "1 guess" : `${guessStats.n} guesses`;
}

function syncGuessHud() {
  const show =
    mode === "guess" &&
    !mp.active &&
    !menuOpen &&
    !paused &&
    !leaveOpen &&
    !guessOpen &&
    guessStats.n > 0;
  if (el.guessHud) el.guessHud.hidden = !show;
  if (show) renderGuessStats();
}

function savedNick() {
  try {
    return String(localStorage.getItem(NICK_KEY) || "").trim();
  } catch {
    return "";
  }
}

function storeNick(name) {
  try {
    localStorage.setItem(NICK_KEY, name);
  } catch {
    /* ignore */
  }
}

function rememberJoin(id) {
  pendingJoinId = id || "";
  try {
    if (id) sessionStorage.setItem(JOIN_KEY, id);
    else sessionStorage.removeItem(JOIN_KEY);
  } catch {
    /* ignore */
  }
}

function savedJoin() {
  try {
    return String(sessionStorage.getItem(JOIN_KEY) || "").trim();
  } catch {
    return "";
  }
}

function stopHelloRetry() {
  clearInterval(helloTimer);
  helloTimer = 0;
}

function sendHello() {
  if (!mp.active || mp.host || welcomed) return;
  mp.net?.send({ t: "hello", name: mp.myName, plane: selectedPlane });
}

function startHelloRetry() {
  stopHelloRetry();
  welcomed = false;
  sendHello();
  let n = 0;
  helloTimer = setInterval(() => {
    if (welcomed || mp.host || !mp.active) {
      stopHelloRetry();
      return;
    }
    sendHello();
    if (++n >= 15) {
      stopHelloRetry();
      setLobbyStatus(
        "Host not found – they should stay in the room, then open the link again",
        true
      );
    }
  }, 800);
}

function normalizeNick(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
}

function uniquePlayerName(base) {
  const taken = new Set(
    [mp.myName, ...[...mp.players.values()].map((p) => p.name)].filter(Boolean)
  );
  if (base && !taken.has(base)) return base;
  for (let i = 0; i < 40; i++) {
    const next = randomUsername();
    if (!taken.has(next)) return next;
  }
  return base || randomUsername();
}

const mp = {
  active: false,
  host: false,
  hostId: "",
  roomId: "",
  myId: "",
  net: null,
  myName: "Host",
  myReady: false,
  myScore: 0,
  wantPlay: false,
  waiting: false,
  inRound: false,
  roundActive: false,
  players: new Map(),
  guesses: new Map(),
  poses: new Map(),
  mates: new Map(),
  seats: {},
  snapped: new Set(),
  goSent: false,
  waitingGo: false,
  truth: null,
  lastPoseAt: 0,
  poseSeq: 0,
  snapInfo: new Map(),
  rematch: new Set(),
  launching: false,
  goAt: 0,
  lastGo: null,
  talkers: new Set(),
  visibility: "private",
  joining: false,
  roomTitle: "",
  phase: "lobby",
  markLeft: 0,
  resultsLeft: 0,
  phaseLeft: 0,
};
if (import.meta.env.DEV) window.__foeMp = mp;

const ctrl = { roll: 0, pitch: 0, throttle: 0.4 };
let throttleLever = 0.4;
let throttleShown = 0.4;
const THROTTLE_RATE = 0.7;
const keys = new Set();
const raycaster = new Raycaster();
raycaster.firstHitOnly = true;
const clock = new Clock();

const el = {
  gSpeed: document.getElementById("g-speed"),
  gAlt: document.getElementById("g-alt"),
  gHdg: document.getElementById("g-hdg"),
  banner: document.getElementById("f-banner"),
  bannerRetry: document.getElementById("banner-retry"),
  bannerMenu: document.getElementById("banner-menu"),
  homeTrail: document.getElementById("home-trail"),
  menu: document.getElementById("menu"),
  city: document.getElementById("city-input"),
  start: document.getElementById("start-btn"),
  menuError: document.getElementById("menu-error"),
  modeDesc: document.getElementById("mode-desc"),
  pause: document.getElementById("pause"),
  pauseTitle: document.getElementById("pause-title"),
  pauseSub: document.getElementById("pause-sub"),
  resume: document.getElementById("btn-resume"),
  restart: document.getElementById("btn-restart"),
  carCanvas: document.getElementById("carousel-canvas"),
  carPrev: document.getElementById("car-prev"),
  carNext: document.getElementById("car-next"),
  carName: document.getElementById("car-name"),
  carDesc: document.getElementById("car-desc"),
  timerBox: document.getElementById("f-timer-box"),
  timer: document.getElementById("f-timer"),
  distBox: document.getElementById("f-dist-box"),
  dist: document.getElementById("f-dist"),
  guessmap: document.getElementById("guessmap"),
  gmCanvas: document.getElementById("gm-canvas"),
  gmResult: document.getElementById("gm-result"),
  gmClose: document.getElementById("gm-close"),
  gmRetry: document.getElementById("gm-retry"),
  gmSub: document.getElementById("gm-sub"),
  gmScoreLeft: document.getElementById("gm-score-left"),
  gmScoreRight: document.getElementById("gm-score-right"),
  guessHud: document.getElementById("f-guess-stats"),
  gmAvg: document.getElementById("gm-avg"),
  gmMin: document.getElementById("gm-min"),
  gmMax: document.getElementById("gm-max"),
  gmStatsN: document.getElementById("gm-stats-n"),
  placeBox: document.getElementById("f-place-box"),
  place: document.getElementById("f-place"),
  mpWait: document.getElementById("mp-wait"),
  mpWaitText: document.getElementById("mp-wait-text"),
  guessScope: document.getElementById("guess-scope"),
  landing: document.getElementById("landing"),
  nick: document.getElementById("nick"),
  nickInput: document.getElementById("nick-input"),
  nickError: document.getElementById("nick-error"),
  nickSub: document.getElementById("nick-sub"),
  nickBack: document.getElementById("nick-back"),
  nickGo: document.getElementById("nick-go"),
  lobby: document.getElementById("lobby"),
  lobbyTitle: document.getElementById("lobby-title"),
  lobbyVis: document.getElementById("lobby-vis"),
  lobbyPhase: document.getElementById("lobby-phase"),
  gmTitle: document.getElementById("gm-title"),
  gmTimer: document.getElementById("gm-timer"),
  btnSolo: document.getElementById("btn-solo"),
  btnMulti: document.getElementById("btn-multi"),
  menuBack: document.getElementById("menu-back"),
  lobbyBack: document.getElementById("lobby-back"),
  lobbyPlayers: document.getElementById("lobby-players"),
  lobbyLink: document.getElementById("lobby-link"),
  lobbyCopy: document.getElementById("lobby-copy"),
  lobbyStart: document.getElementById("lobby-start"),
  lobbyStatus: document.getElementById("lobby-status"),
  lobbyScopes: document.getElementById("lobby-scopes"),
  lobbyModeDesc: document.getElementById("lobby-mode-desc"),
  lobbyCity: document.getElementById("lobby-city"),
  mapLock: document.getElementById("map-lock"),
  ionKeyInput: document.getElementById("ion-key-input"),
  ionKeySave: document.getElementById("ion-key-save"),
  ionKeyStatus: document.getElementById("ion-key-status"),
  voiceInd: document.getElementById("voice-ind"),
  mpOnline: document.getElementById("mp-online"),
  mpOnlineCount: document.getElementById("mp-online-count"),
  mpTab: document.getElementById("mp-tab"),
  mpTabList: document.getElementById("mp-tab-list"),
  touch: document.getElementById("touch"),
  touchPause: document.getElementById("touch-pause"),
  stick: document.getElementById("stick"),
  stickKnob: document.getElementById("stick-knob"),
  touchBoost: document.getElementById("touch-boost"),
  touchBrake: document.getElementById("touch-brake"),
  throttle: document.getElementById("throttle"),
  throttleRail: document.getElementById("throttle-rail"),
  throttleKnob: document.getElementById("throttle-knob"),
  touchTalk: document.getElementById("touch-talk"),
  touchMap: document.getElementById("touch-map"),
  freemap: document.getElementById("freemap"),
  fmCanvas: document.getElementById("fm-canvas"),
  fmPlace: document.getElementById("fm-place"),
  fmClose: document.getElementById("fm-close"),
  fmZoomIn: document.getElementById("fm-zoom-in"),
  fmZoomOut: document.getElementById("fm-zoom-out"),
  minimap: document.getElementById("minimap"),
  mmCanvas: document.getElementById("mm-canvas"),
  mapNote: document.getElementById("map-note"),
  dragonRelease: document.getElementById("dragon-release"),
  missileFire: document.getElementById("missile-fire"),
  droneFire: document.getElementById("drone-fire"),
  lobbyCarCanvas: document.getElementById("lobby-carousel-canvas"),
  lobbyCarPrev: document.getElementById("lobby-car-prev"),
  lobbyCarNext: document.getElementById("lobby-car-next"),
  lobbyCarName: document.getElementById("lobby-car-name"),
  lobbyCarDesc: document.getElementById("lobby-car-desc"),
  fatal: document.getElementById("fatal"),
  fatalText: document.getElementById("fatal-text"),
  fatalOk: document.getElementById("fatal-ok"),
  crashNote: document.getElementById("crash-note"),
};

const freeMap = createFreeMap({
  root: el.freemap,
  canvas: el.fmCanvas,
  place: el.fmPlace,
  close: el.fmClose,
  zoomIn: el.fmZoomIn,
  zoomOut: el.fmZoomOut,
  onChange: () => updateLocationMaps(),
});

const miniMap = createMiniMap({
  root: el.minimap,
  canvas: el.mmCanvas,
  onOpen: () => {
    if (!freeMap.open) toggleFreeMap();
  },
});

function canOpenFreeMap() {
  return (
    mode === "free" &&
    plane?.height < 100000 &&
    !menuOpen &&
    !paused &&
    !guessOpen &&
    !crashed &&
    !finished
  );
}

function poseForMaps() {
  if (!plane) return null;
  return {
    lat: plane.latDeg,
    lon: plane.lonDeg,
    heading: plane.headingDeg,
    name: el.place?.textContent || "",
  };
}

function updateLocationMaps() {
  const pose = poseForMaps();
  const showMini = canOpenFreeMap() && !freeMap.open;
  if (showMini && pose) {
    miniMap.update(pose.lat, pose.lon, pose.heading);
    miniMap.show();
  } else {
    miniMap.hide();
  }
  if (freeMap.open && pose) {
    freeMap.update(pose.lat, pose.lon, pose.heading, pose.name);
  }
}

let mapNoteTimer = 0;

function hideMapNote() {
  if (mapNoteTimer) {
    clearTimeout(mapNoteTimer);
    mapNoteTimer = 0;
  }
  if (!el.mapNote) return;
  el.mapNote.classList.remove("show");
  el.mapNote.hidden = true;
}

function showMapUnavailable() {
  if (!el.mapNote || menuOpen || paused || guessOpen) return;
  el.mapNote.hidden = false;
  el.mapNote.classList.add("show");
  if (mapNoteTimer) clearTimeout(mapNoteTimer);
  mapNoteTimer = setTimeout(hideMapNote, 2200);
}

function toggleFreeMap() {
  if (plane?.height >= 100000 && !menuOpen && !paused && !guessOpen) { toggleSpaceMap(); return; }
  if (!canOpenFreeMap() && !freeMap.open) return;
  if (freeMap.open) {
    freeMap.hide();
    updateLocationMaps();
    return;
  }
  const pose = poseForMaps();
  if (!pose || !canOpenFreeMap()) return;
  freeMap.update(pose.lat, pose.lon, pose.heading, pose.name);
  freeMap.show();
  miniMap.hide();
}

// karuzela pojazdów — jeden duży podgląd, strzałki w bok
const planePreviewItems = PLANE_ORDER.map((k) => ({
  key: k,
  file: PLANES[k].file,
  create: PLANES[k].create,
  vertical: PLANES[k].previewVertical ?? PLANES[k].vertical,
  wingspan: PLANES[k].wingspan,
  prepare: PLANES[k].prepare,
}));
const carousel = createCarousel(el.carCanvas, planePreviewItems, {
  mobile: isMobile,
});
let lobbyCarousel = createCarousel(el.lobbyCarCanvas, planePreviewItems, {
  lite: isMobile,
  mobile: isMobile,
});
let lobbyCarouselLive = !isMobile;

function ensureLobbyCarousel() {
  if (lobbyCarouselLive) return;
  lobbyCarousel.dispose();
  lobbyCarousel = createCarousel(el.lobbyCarCanvas, planePreviewItems, {
    mobile: true,
  });
  lobbyCarouselLive = true;
  lobbyCarousel.show(selectedPlane, 0);
}
let planeIdx = 0;
const flightHints = [...document.querySelectorAll(".hint-desk, .hint-touch")].map(node => ({ node, html: node.innerHTML }));
function selectPlane(i, dir, silent = false) {
  planeIdx = (i + PLANE_ORDER.length) % PLANE_ORDER.length;
  selectedPlane = PLANE_ORDER[planeIdx];
  carousel.show(selectedPlane, dir);
  lobbyCarousel.show(selectedPlane, dir);
  const spec = PLANES[selectedPlane];
  el.carName.textContent = spec.name;
  el.carDesc.textContent = spec.desc;
  el.lobbyCarName.textContent = spec.name;
  el.lobbyCarDesc.textContent = spec.desc;
  for (const hint of flightHints) {
    hint.node.innerHTML = selectedPlane === "sailplane"
      ? hint.node.classList.contains("hint-touch")
        ? "Drag the stick to glide · nose down gains speed, nose up trades speed for height · slide AIRBRK to descend faster"
        : "<kbd>W</kbd> nose down / gain speed · <kbd>S</kbd> nose up / slow down · <kbd>A</kbd><kbd>D</kbd> bank · scroll or drag AIRBRK · <kbd>Ctrl</kbd> airbrakes · <kbd>Shift</kbd> retract airbrakes · <kbd>,</kbd> / <kbd>.</kbd> retract / extend · <kbd>B</kbd> wheel brake · <kbd>C</kbd> camera · <kbd>M</kbd> map · <kbd>Esc</kbd> pause"
      : selectedPlane === "balloon"
        ? hint.node.classList.contains("hint-touch")
          ? "Red hot-air balloon · slide HEAT to warm or cool the envelope · pull the stick to heat, push to cool · wind carries the balloon · C cycles cameras, including basket view"
          : "<kbd>S</kbd> / <kbd>Shift</kbd> heat to climb · <kbd>W</kbd> / <kbd>Ctrl</kbd> cool to descend · scroll or drag HEAT · <kbd>A</kbd><kbd>D</kbd> rotate basket view · wind controls drift · <kbd>C</kbd> camera · <kbd>M</kbd> map · <kbd>Esc</kbd> pause"
        : hint.html;
  }
  if (!silent && mp.active && mp.net) {
    mp.net.send({ t: "plane", plane: selectedPlane, from: mp.myId });
    renderLobby();
  }
}
el.carPrev.addEventListener("click", () => selectPlane(planeIdx - 1, -1));
el.carNext.addEventListener("click", () => selectPlane(planeIdx + 1, 1));
el.lobbyCarPrev.addEventListener("click", () => selectPlane(planeIdx - 1, -1));
el.lobbyCarNext.addEventListener("click", () => selectPlane(planeIdx + 1, 1));
selectPlane(0, 0, true);
carousel.setActive(false);
lobbyCarousel.setActive(false);

// wybór trybu — same przyciski, instrukcja pokazuje się dopiero pod spodem
const airportSelect = document.getElementById("landing-airport");
const runwaySelect = document.getElementById("landing-runway");
const landingAirports = [...new Map(airportRunways.runways.map(r => [r.data.airportId, r.data])).values()]
  .sort((a, b) => a.airportName.localeCompare(b.airportName, "pl"));
for (const airport of landingAirports) {
  airportSelect.add(new Option(`${airport.airportName} (${airport.airportId})`, airport.airportId));
}
airportSelect.value = airportRunways.get(selectedApproach).definition.airportId;
function syncLandingSelection(keepDirection = false) {
  const options = airportRunways.approaches.filter(r => r.definition.airportId === airportSelect.value);
  runwaySelect.replaceChildren(...options.map(r => new Option(`RWY ${r.definition.ident} · ${Math.round(r.definition.heading)}°`, r.definition.id)));
  selectedApproach = keepDirection && options.some(r => r.definition.id === selectedApproach) ? selectedApproach : options[0].definition.id;
  runwaySelect.value = selectedApproach;
  syncRunwayInfo();
}
function syncRunwayInfo() {
  const d = airportRunways.get(selectedApproach).definition;
  const short = d.length - d.threshold < 1200 ? " · Short runway: choose a light aircraft" : "";
  document.getElementById("landing-runway-info").textContent = `${Math.round(d.length)} × ${d.widthEstimated ? "~" : ""}${Math.round(d.width)} m · landing distance ${Math.round(d.length - d.threshold)} m${short}`;
}
airportSelect.addEventListener("change", () => syncLandingSelection());
runwaySelect.addEventListener("change", () => { selectedApproach = runwaySelect.value; syncRunwayInfo(); });
syncLandingSelection(true);

const MODE_PLACEHOLDERS = {
  landing: "Choose an airport and runway",
  free: "Starting city… e.g. Paris",
  home: "Your address… e.g. 5th Avenue, New York",
  guess: "",
};
const MODE_DESCS = {
  landing: "Choose a paved runway in Poland. G: landing gear. Reduce throttle, flare gently with S, then hold B to brake. Landing also works during Free flight.",
  free: "Pick a starting city and fly with no time limit. Land on paved runways across Poland: extend gear with G, touch down on the main wheels and hold B to brake.",
  home: "We drop you ~30 km from home. You have 10 minutes to find your way back.",
  guess:
    "You have one minute in the air to get your bearings, then mark on the map where you are.",
};
function selectMode(m) {
  if (awaitingSnap || el.start.disabled) return;
  mode = m;
  document
    .querySelectorAll("#menu .mode-card")
    .forEach((b) => b.classList.toggle("selected", b.dataset.mode === m));
  el.modeDesc.textContent = MODE_DESCS[m];
  el.city.placeholder = MODE_PLACEHOLDERS[m];
  el.city.style.display = m === "guess" || m === "landing" ? "none" : "";
  document.getElementById("landing-selectors").hidden = m !== "landing";
  el.guessScope.style.display = m === "guess" ? "" : "none";
  el.menuError.textContent = "";
  if (m === "guess") GUESS_SCOPES[guessScope]?.load().catch(() => {});
}
document.querySelectorAll("#menu .mode-card").forEach((btn) => {
  btn.addEventListener("click", () => selectMode(btn.dataset.mode));
});
document.querySelectorAll("#menu .scope-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    guessScope = btn.dataset.scope;
    geoCache = null;
    geoCacheScope = null;
    GUESS_SCOPES[guessScope]?.load().catch(() => {});
    document
      .querySelectorAll("#menu .scope-btn")
      .forEach((b) => b.classList.toggle("selected", b === btn));
  });
});
selectMode("guess");
detectLocale();
applyRegionLabels();

function applyRegionLabels() {
  const { country, continent } = getRegionPack();
  document.querySelectorAll('[data-scope="pl"]').forEach((b) => {
    b.textContent = `${country.flag} ${country.name}`;
  });
  document.querySelectorAll('[data-scope="eu"]').forEach((b) => {
    b.textContent = `${continent.flag} ${continent.name}`;
  });
  GUESS_SCOPES.pl.sub = `Click a point on the map of ${country.name}`;
  GUESS_SCOPES.pl.status = `Picking a point in ${country.name}…`;
  GUESS_SCOPES.eu.sub = `Click a point on the map of ${continent.name}`;
  GUESS_SCOPES.eu.status = `Picking a point in ${continent.name}…`;
}

function applyRemoteRegion(data) {
  if (!data || (!data.country && !data.continent)) return;
  setRegionPack(data.country, data.continent);
  geoCache = null;
  geoCacheScope = null;
  applyRegionLabels();
}

function showFatal(msg) {
  const text = msg || "Could not start on this phone.";
  rememberError(text);
  if (el.fatalText) el.fatalText.textContent = text;
  if (el.fatal) el.fatal.classList.remove("hidden");
  if (el.crashNote) {
    el.crashNote.hidden = false;
    el.crashNote.textContent = text;
  }
  if (el.menuError) el.menuError.textContent = text;
}

function hideFatal() {
  if (el.fatal) el.fatal.classList.add("hidden");
}

function showCrashHints() {
  // Stale session notes must never block the menu. A refresh is not a crash.
  const prev = lastError();
  if (!prev) return;
  if (/Phone closed the tab|out of memory|Light mode is on/i.test(prev)) {
    clearError();
    clearStarting();
    hideFatal();
    if (el.crashNote) {
      el.crashNote.hidden = true;
      el.crashNote.textContent = "";
    }
    if (el.menuError) el.menuError.textContent = "";
    return;
  }
  if (el.crashNote) {
    el.crashNote.hidden = false;
    el.crashNote.textContent = prev;
  }
}

el.fatalOk?.addEventListener("click", () => hideFatal());
showCrashHints();

function scopeLabel(scope = guessScope) {
  const pack = getRegionPack();
  if (scope === "pl") return pack.country.name;
  if (scope === "eu") return pack.continent.name;
  return "World";
}

function roomTitleFromParams(scope = guessScope) {
  return `Guess the region: ${scopeLabel(scope)}`;
}

function playerCountLabel(n = 1 + mp.players.size) {
  return `${n} player${n === 1 ? "" : "s"}`;
}

function syncRoomTitle() {
  mp.roomTitle = roomTitleFromParams();
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showNick(opts = {}) {
  rememberJoin(
    opts.roomId || parseRoomFromUrl() || pendingJoinId || savedJoin() || ""
  );
  menuOpen = true;
  el.landing.classList.add("hidden");
  el.menu.classList.add("hidden");
  el.lobby.classList.add("hidden");
  el.nick.classList.remove("hidden");
  if (el.nickSub) {
    el.nickSub.textContent = pendingJoinId
      ? "Choose a nickname to join"
      : "Choose a nickname";
  }
  if (el.nickInput) {
    el.nickInput.value = normalizeNick(el.nickInput.value) || savedNick();
    queueMicrotask(() => {
      el.nickInput.focus();
      el.nickInput.select();
    });
  }
  if (el.nickError) el.nickError.textContent = "";
}

function submitNick() {
  const name = normalizeNick(el.nickInput?.value);
  if (name.length < 2) {
    if (el.nickError) el.nickError.textContent = "Enter at least 2 characters";
    el.nickInput?.focus();
    return;
  }
  mp.myName = name;
  storeNick(name);
  const joinId = pendingJoinId || parseRoomFromUrl() || savedJoin();
  if (joinId) {
    if (wasHosting(joinId)) openHostLobby(joinId);
    else openGuestLobby(joinId);
    return;
  }
  rememberJoin("");
  openHostLobby();
}

function showLanding() {
  hostGen += 1;
  closeRoom();
  mp.active = false;
  menuOpen = true;
  el.menu.classList.add("hidden");
  el.lobby.classList.add("hidden");
  el.nick?.classList.add("hidden");
  rememberJoin("");
  carousel.setActive(false);
  lobbyCarousel.setActive(false);
  rememberHost("");
  syncMapLockUi();
  setRoomUrl("");
}

function showSoloMenu() {
  mp.active = false;
  menuOpen = true;
  el.landing.classList.add("hidden");
  el.lobby.classList.add("hidden");
  el.nick?.classList.add("hidden");
  el.menu.classList.remove("hidden");
  carousel.setActive(true);
  lobbyCarousel.setActive(false);
}

function showLobby() {
  menuOpen = true;
  el.landing.classList.add("hidden");
  el.menu.classList.add("hidden");
  el.nick?.classList.add("hidden");
  el.lobby.classList.remove("hidden");
  carousel.setActive(false);
  ensureLobbyCarousel();
  lobbyCarousel.setActive(true);
  applyLobbySetup();
  renderLobby();
  updateVoiceUi();
  updateMpPresence();
}

function setLobbyStatus(msg, isErr = false) {
  el.lobbyStatus.textContent = msg;
  el.lobbyStatus.classList.toggle("err", isErr);
}

function otherPlayers() {
  return [...mp.players.values()];
}

function playablePlayers() {
  const list = [];
  if (!mp.waiting) list.push({ id: mp.myId });
  for (const p of mp.players.values()) if (!p.waiting) list.push(p);
  return list;
}

function inRoundPlayers() {
  const list = [];
  if (mp.inRound) list.push({ id: mp.myId, name: mp.myName });
  for (const p of mp.players.values()) if (p.inRound) list.push(p);
  return list;
}

function playerColor(id) {
  const ids = [mp.myId, ...mp.players.keys()];
  const i = Math.max(0, ids.indexOf(id));
  return PLAYER_COLORS[i % PLAYER_COLORS.length];
}

function playerName(id) {
  if (id === mp.myId) return "You";
  return mp.players.get(id)?.name || "Player";
}

function rosterPayload() {
  return [
    {
      id: mp.myId,
      name: mp.myName,
      plane: selectedPlane,
      ready: mp.myReady,
      score: mp.myScore,
      waiting: mp.wantPlay && mp.roundActive && !mp.inRound,
      inRound: mp.inRound,
      joined: mp.wantPlay,
    },
    ...otherPlayers().map((p) => ({
      id: p.id,
      name: p.name,
      plane: p.plane,
      ready: p.ready,
      score: p.score,
      waiting: !!p.waiting,
      inRound: !!p.inRound,
      joined: !!p.joined,
    })),
  ];
}

function phasePayload() {
  let left = 0;
  if (mp.phase === "fly") left = timeLeft;
  else if (mp.phase === "mark") left = mp.markLeft;
  else if (mp.phase === "results") left = mp.resultsLeft;
  const phase = mp.roundActive ? mp.phase : "lobby";
  mp.phaseLeft = left;
  return { phase, left };
}

function applyPhaseInfo(data) {
  if (!data) return;
  if (data.phase) mp.phase = data.phase;
  if (Number.isFinite(data.left)) mp.phaseLeft = data.left;
}

function humansWantPlay() {
  if (mp.wantPlay) return true;
  return otherPlayers().some((p) => p.joined);
}

function isLocallyFlying() {
  return !!(mp.inRound && mp.roundActive && (!menuOpen || awaitingSnap));
}

function humansInRound() {
  if (mp.inRound) return true;
  return otherPlayers().some((p) => p.inRound);
}

function isRoundLive() {
  if (!mp.roundActive || mp.launching || !mp.truth) return false;
  if (mp.phase === "mark" || mp.phase === "results")
    return humansInRound() || mp.goSent;
  if (mp.phase === "fly") return humansInRound();
  return false;
}

function lobbyPhaseText() {
  const phase = mp.roundActive ? mp.phase : "lobby";
  const left = Math.max(
    0,
    Math.ceil(
      Number.isFinite(mp.phaseLeft)
        ? mp.phaseLeft
        : phase === "fly"
        ? timeLeft
        : phase === "mark"
        ? mp.markLeft
        : mp.resultsLeft
    )
  );
  if (phase === "fly" && mp.roundActive) return `In flight — ${left}s left`;
  if (phase === "mark") return `Marking the map — ${left}s left`;
  if (phase === "results") return `Results — next round in ${left}s`;
  return "Pick a plane, copy the link, then start";
}

let tabListOpen = false;

function setTabList(open) {
  tabListOpen = !!(open && mp.active && !menuOpen);
  if (tabListOpen) renderTabList();
  else el.mpTab?.classList.add("hidden");
}

function renderTabList() {
  if (!el.mpTabList) return;
  const people = [
    {
      name: mp.myName || "You",
      score: mp.myScore || 0,
      you: true,
    },
    ...otherPlayers().map((p) => ({
      name: p.name || "Player",
      score: p.score || 0,
      you: false,
    })),
  ].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  el.mpTabList.innerHTML = people
    .map((p) => {
      const pts = `${p.score} pt${p.score === 1 ? "" : "s"}`;
      const you = p.you ? " (You)" : "";
      return `<div class="mp-tab-row"><span class="p-name${
        p.you ? " p-you" : ""
      }"><i class="online-dot" aria-hidden="true"></i>${escapeHtml(
        p.name
      )}${you}</span><span class="p-score">${pts}</span></div>`;
    })
    .join("");
  el.mpTab.classList.remove("hidden");
}

function updateMpPresence() {
  const show = mp.active && !menuOpen;
  el.mpOnline?.classList.toggle("hidden", !show);
  if (!show) {
    setTabList(false);
    return;
  }
  if (el.mpOnlineCount)
    el.mpOnlineCount.textContent = `${1 + mp.players.size} online`;
  if (tabListOpen) renderTabList();
}

function applyRoster(list = []) {
  const keep = new Set();
  for (const p of list) {
    if (p.id === mp.myId) {
      mp.myScore = p.score ?? mp.myScore;
      if (!mp.wantPlay) {
        mp.waiting = false;
        mp.inRound = false;
      }
      continue;
    }
    keep.add(p.id);
    const prev = mp.players.get(p.id) || {};
    mp.players.set(p.id, { ...prev, ...p, joined: !!p.joined });
  }
  for (const id of [...mp.players.keys()]) {
    if (!keep.has(id)) {
      mp.players.delete(id);
      disposeMate(id);
    }
  }
  updateMpPresence();
}

function remainingPeerIds() {
  return [...new Set([mp.myId, ...mp.players.keys()].filter(Boolean))].sort();
}

function applyHost(id) {
  if (!id) return;
  mp.hostId = id;
  mp.host = id === mp.myId;
  if (mp.host) {
    mp.joining = false;
    welcomed = true;
    stopHelloRetry();
    rememberHost(mp.roomId);
  }
}

function considerHost(id) {
  if (!id) return;
  if (mp.host && id !== mp.myId && id > mp.myId) return;
  applyHost(id);
}

function claimHost() {
  applyHost(mp.myId);
  mp.net?.send({ t: "host", id: mp.myId });
  broadcastRoster();
  resumeHostDuties();
}

function electHostIfNeeded(leftId) {
  if (!mp.active) return;
  if (mp.joining && !welcomed && leftId !== mp.hostId) return;
  const alive = remainingPeerIds();
  if (mp.hostId && alive.includes(mp.hostId)) return;
  const winner = alive[0];
  if (!winner) return;
  if (winner === mp.myId) {
    if (!mp.host) setLobbyStatus("You are the host now — the room stays open");
    claimHost();
    return;
  }
  applyHost(winner);
}

function resumeHostDuties() {
  if (!mp.host) return;
  if (!isRoundLive()) {
    if (mp.roundActive) finishRoomRound();
    mp.phase = "lobby";
    if (humansWantPlay() && !mp.launching) launchMpRound();
    else broadcastRoster();
    renderLobby();
    updateMpPresence();
    return;
  }
  if (mp.phase === "results") {
    if (mp.resultsLeft <= 0 && !mp.launching && humansWantPlay())
      launchMpRound();
    else tryLaunchRematch();
  } else {
    if (mp.roundActive && !mp.goSent) tryReleaseGo();
    checkRoundClear();
    tryLaunchRematch();
  }
  renderLobby();
  updateMpPresence();
}

function dropPeer(peerId) {
  if (!peerId) return null;
  dropVoicePeer(peerId);
  mp.talkers.delete(peerId);
  const gone = mp.players.get(peerId) || null;
  mp.players.delete(peerId);
  mp.poses.delete(peerId);
  mp.guesses.delete(peerId);
  mp.snapped.delete(peerId);
  mp.snapInfo.delete(peerId);
  mp.rematch.delete(peerId);
  disposeMate(peerId);
  updateVoiceUi();
  return gone;
}

function broadcastRoster() {
  if (!mp.host || !mp.net) return;
  mp.net.send({
    t: "roster",
    hostId: mp.myId,
    players: rosterPayload(),
    roundActive: mp.roundActive,
    mode: "guess",
    scope: guessScope,
    visibility: mp.visibility,
    title: mp.roomTitle,
    city: el.lobbyCity.value,
    ...phasePayload(),
    ...regionPayload(),
  });
}

function renderLobby() {
  const rows = [
    playerRow(
      {
        name: mp.myName,
        plane: selectedPlane,
        ready: mp.myReady,
        score: mp.myScore,
        waiting: mp.waiting,
        inRound: mp.inRound && mp.roundActive,
      },
      true
    ),
  ];
  for (const p of otherPlayers()) rows.push(playerRow(p, false));
  if (mp.players.size === 0) {
    rows.push(
      `<div class="player-row empty">${
        mp.joining ? "Connecting…" : "Share the link to invite friends"
      }</div>`
    );
  }
  el.lobbyPlayers.innerHTML = rows.join("");
  el.lobbyScopes.classList.toggle("locked", !mp.host);
  if (el.lobbyCity) {
    el.lobbyCity.style.display = "none";
    el.lobbyCity.classList.add("locked");
    el.lobbyCity.readOnly = true;
  }
  if (mp.roomId) el.lobbyLink.value = roomLink(mp.roomId);
  document.querySelector(".lobby-link-row")?.classList.remove("hidden");
  if (el.lobbyTitle) el.lobbyTitle.textContent = roomTitleFromParams();
  if (el.lobbyVis) el.lobbyVis.textContent = playerCountLabel();
  if (el.lobbyPhase) el.lobbyPhase.textContent = lobbyPhaseText();

  const flyingHere = isLocallyFlying();
  const queued = mp.wantPlay && mp.roundActive && !mp.inRound && isRoundLive();
  el.lobbyStart.disabled = flyingHere || queued || mp.launching || mp.joining;
  el.lobbyStart.textContent = mp.joining
    ? "Joining room…"
    : flyingHere
    ? "In match"
    : queued
    ? "Queued — next round"
    : mp.launching
    ? "Starting…"
    : !mp.host || mp.roundActive
    ? "Join"
    : "Start match";

  if (mp.joining) setLobbyStatus("Joining room…");
  else if (queued) setLobbyStatus("Next round.");
  else setLobbyStatus("");
}

function playerRow(p, isSelf) {
  const plane = PLANES[p.plane]?.name || "";
  const pts = ` · ${p.score || 0} pts`;
  let badge = "IN LOBBY";
  let cls = "";
  if (p.inRound && (isSelf ? isLocallyFlying() : mp.roundActive)) {
    badge = "IN FLIGHT";
    cls = " ingame";
  } else if (p.waiting || (p.joined && isRoundLive() && !p.inRound)) {
    badge = "QUEUED";
    cls = " waiting";
  } else if (p.ready || p.joined) {
    badge = "READY";
    cls = " ready";
  }
  return `<div class="player-row${cls}"><div class="p-meta"><span class="p-name"><i class="online-dot" aria-hidden="true"></i>${escapeHtml(
    p.name
  )}${
    isSelf ? " (You)" : ""
  }</span><span class="p-plane">${plane}${pts}</span></div><span class="p-ready">${badge}</span></div>`;
}

function applyLobbySetup() {
  mode = "guess";
  if (el.lobbyModeDesc) {
    el.lobbyModeDesc.textContent =
      "One minute in the air, 10 seconds to mark the map, then scores and the next round.";
  }
  el.lobbyScopes.style.display = "flex";
  if (el.lobbyCity) el.lobbyCity.style.display = "none";
}

function selectLobbyMode(m, broadcast = false) {
  mode = m;
  applyLobbySetup();
  if (broadcast && mp.host && mp.net) {
    mp.myReady = false;
    for (const p of mp.players.values()) p.ready = false;
    mp.net.send({
      t: "mode",
      mode: m,
      city: el.lobbyCity.value,
      scope: guessScope,
      ...regionPayload(),
    });
    broadcastRoster();
  }
  renderLobby();
}

function attachNet(api) {
  mp.net = api;
  bindVoice(api);
}

function voiceTargets() {
  return [...mp.players.keys()];
}

function voiceEnabled() {
  return mp.active && !!mp.net;
}

function refreshVoice() {
  if (!voiceEnabled()) return;
  syncVoiceCalls(voiceTargets());
}

let wantTalk = false;

async function startTalk() {
  if (!voiceEnabled()) return;
  wantTalk = true;
  if (isTalking()) return;
  unlockAudio();
  const mic = await ensureMic();
  if (!mic) {
    wantTalk = false;
    updateVoiceUi();
    return;
  }
  if (!wantTalk) return;
  refreshVoice();
  setTalking(true);
  mp.net?.send({ t: "talk", on: true, from: mp.myId });
  updateVoiceUi();
}

function stopTalk() {
  wantTalk = false;
  if (!isTalking()) return;
  setTalking(false);
  if (mp.active) mp.net?.send({ t: "talk", on: false, from: mp.myId });
  updateVoiceUi();
}

function updateVoiceUi() {
  const box = el.voiceInd;
  if (!box) return;
  if (!voiceEnabled()) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  box.classList.toggle("live", isTalking());
  if (voiceDenied()) {
    box.textContent = "Microphone blocked – allow access in the browser";
    return;
  }
  if (isTalking()) {
    box.textContent = "Talking…";
    return;
  }
  const who = [...mp.talkers].map((id) => playerName(id)).filter(Boolean);
  box.textContent = who.length
    ? `${who.join(", ")} talking…`
    : "Hold T to talk";
}

async function handleVoiceCall(call) {
  if (!call || !voiceEnabled()) return;
  await ensureMic();
  answerCall(call);
  refreshVoice();
}

function handleNetData(data, fromId) {
  if (!data || !data.t) return;
  if (fromId) data = { ...data, from: fromId };

  if (data.t === "hello") {
    if (!mp.host || !fromId) return;
    const name = uniquePlayerName(data.name);
    mp.players.set(fromId, {
      id: fromId,
      name,
      plane: data.plane || "pa28",
      ready: false,
      score: 0,
      waiting: false,
      inRound: false,
      joined: false,
    });
    mp.net.sendTo(fromId, {
      t: "welcome",
      id: fromId,
      name,
      hostId: mp.myId,
      roster: rosterPayload(),
      roundActive: mp.roundActive,
      ...phasePayload(),
      mode: "guess",
      scope: guessScope,
      visibility: mp.visibility,
      title: mp.roomTitle,
      city: el.lobbyCity.value,
      ...regionPayload(),
    });
    broadcastRoster();
    renderLobby();
    updateMpPresence();
    refreshVoice();
  } else if (data.t === "who") {
    sendHello();
  } else if (data.t === "host") {
    const id = data.id || data.from;
    if (!id) return;
    if (id !== mp.myId && remainingPeerIds()[0] === mp.myId && id > mp.myId) {
      if (!mp.host) claimHost();
      return;
    }
    applyHost(id);
    if (mp.joining && !welcomed) sendHello();
    renderLobby();
  } else if (data.t === "welcome") {
    welcomed = true;
    mp.joining = false;
    stopHelloRetry();
    rememberJoin("");
    if (data.id) mp.myId = data.id;
    if (data.name) mp.myName = data.name;
    applyHost(data.hostId || fromId);
    mp.roundActive = !!data.roundActive;
    if (!mp.wantPlay) {
      mp.waiting = false;
      mp.inRound = false;
    }
    applyPhaseInfo(data);
    applyRemoteRegion(data);
    if (data.visibility) mp.visibility = data.visibility;
    if (data.title) mp.roomTitle = data.title;
    if (data.scope) setLobbyScope(data.scope);
    selectLobbyMode("guess");
    if (data.city != null) el.lobbyCity.value = data.city;
    applyRoster(data.roster);
    applyLobbySetup();
    renderLobby();
    refreshVoice();
  } else if (data.t === "roster") {
    if (!mp.host) {
      welcomed = true;
      mp.joining = false;
      stopHelloRetry();
      rememberJoin("");
    }
    mp.roundActive = !!data.roundActive;
    applyRemoteRegion(data);
    if (data.visibility) mp.visibility = data.visibility;
    if (data.title) mp.roomTitle = data.title;
    if (data.scope) setLobbyScope(data.scope);
    selectLobbyMode("guess");
    if (data.city != null) el.lobbyCity.value = data.city;
    considerHost(data.hostId || fromId);
    applyPhaseInfo(data);
    applyRoster(data.players);
    applyLobbySetup();
    renderLobby();
    refreshVoice();
  } else if (data.t === "scope") {
    applyRemoteRegion(data);
    setLobbyScope(data.scope);
  } else if (data.t === "mode") {
    applyRemoteRegion(data);
    if (data.scope) setLobbyScope(data.scope);
    if (data.city != null) el.lobbyCity.value = data.city;
    mp.myReady = false;
    for (const p of mp.players.values()) p.ready = false;
    selectLobbyMode("guess");
  } else if (data.t === "city") {
    el.lobbyCity.value = data.city || "";
  } else if (data.t === "plane") {
    const id = data.from;
    if (id && mp.players.has(id))
      mp.players.get(id).plane = data.plane || "pa28";
    renderLobby();
  } else if (data.t === "ready") {
    const id = data.from;
    if (id && mp.players.has(id)) mp.players.get(id).ready = !!data.ready;
    renderLobby();
    tryStartMp();
  } else if (data.t === "talk") {
    if (data.from && data.from !== mp.myId) {
      if (data.on) mp.talkers.add(data.from);
      else mp.talkers.delete(data.from);
      updateVoiceUi();
    }
  } else if (data.t === "snapped") {
    if (data.from) {
      mp.snapInfo.set(data.from, {
        h: data.h,
        gh: data.gh,
        heading: data.heading ?? 0,
        probed: data.probed !== false,
      });
      mp.snapped.add(data.from);
    }
    if (mp.host) tryReleaseGo();
  } else if (data.t === "go") {
    applyGo(data);
  } else if (data.t === "rematch") {
    if (data.from) mp.rematch.add(data.from);
    updateRematchWait();
    if (mp.host) tryLaunchRematch();
  } else if (data.t === "join") {
    const id = data.from;
    if (id && mp.players.has(id)) {
      const p = mp.players.get(id);
      p.joined = true;
      p.plane = data.plane || p.plane;
    }
    if (mp.host) admitPlayer(id);
    renderLobby();
  } else if (data.t === "phase") {
    applyPhaseInfo(data);
    if (data.roundActive != null) mp.roundActive = !!data.roundActive;
    if (menuOpen) renderLobby();
  } else if (data.t === "start") {
    applyRemoteRegion(data);
    considerHost(data.hostId || fromId);
    applyPhaseInfo(data);
    const seated = !data.seats || !mp.myId || data.seats[mp.myId] != null;
    if (!mp.wantPlay || !seated) {
      mp.roundActive = true;
      mp.waiting = mp.wantPlay;
      mp.inRound = false;
      mp.phase = data.phase || "fly";
      renderLobby();
      return;
    }
    startMpFlight(data);
  } else if (data.t === "pose") {
    const id = data.from;
    if (!id || id === mp.myId) return;
    pushMatePose(id, data);
    loadMate(id, data.plane || "pa28");
  } else if (data.t === "missile") {
    receiveFighterMissile(data);
  } else if (data.t === "drone-burst") {
    receiveDroneBurst(data);
  } else if (data.t === "guess") {
    const id = data.from;
    if (!id || id === mp.myId) return;
    mp.guesses.set(id, { lat: data.lat, lon: data.lon });
    if (guessOpen) maybeRevealGuesses();
  } else if (data.t === "done") {
    const id = data.from;
    if (id && mp.players.has(id)) mp.players.get(id).inRound = false;
    if (mp.host) {
      if (mp.rematch.size) abortRematchToLobby();
      else checkRoundClear();
    }
    renderLobby();
  } else if (data.t === "roundEnd") {
    const waitingRematch =
      mp.rematch.has(mp.myId) || !el.mpWait.classList.contains("hidden");
    finishRoomRound();
    hideMpWait();
    if (waitingRematch || guessOpen) {
      el.guessmap.classList.remove("show");
      guessOpen = false;
      showLobby();
    }
    renderLobby();
  }
}

function handlePeerJoined(peerId) {
  if (mp.host) {
    if (peerId) mp.net?.sendTo(peerId, { t: "who" });
    return;
  }
  sendHello();
}

function handlePeerLeft(peerId) {
  if (!peerId) {
    const live = [...(mp.net?.getPeers?.() || [])];
    if (mp.joining && !welcomed) return;
    if (live.length) {
      for (const id of [...mp.players.keys()]) {
        if (!live.includes(id)) dropPeer(id);
      }
    } else if (mp.hostId && mp.hostId !== mp.myId) {
      dropPeer(mp.hostId);
    }
    electHostIfNeeded(mp.hostId);
    if (guessOpen) maybeRevealGuesses();
    renderLobby();
    updateMpPresence();
    return;
  }
  const wasHost = peerId === mp.hostId;
  const gone = dropPeer(peerId);
  electHostIfNeeded(peerId);
  if (mp.host) {
    if (mp.phase !== "results") checkRoundClear();
    broadcastRoster();
  }
  if (guessOpen) maybeRevealGuesses();
  renderLobby();
  updateMpPresence();
  if (wasHost && mp.host)
    setLobbyStatus("You are the host now — the room stays open");
  else if (gone) setLobbyStatus(`${gone.name} left the room`);
}

function handleNetError(err) {
  if (mp.host && err?.type === "peer-unavailable") return;
  if (err?.type === "unavailable-id" && mp.host && mp.roomId) {
    openGuestLobby(mp.roomId);
    return;
  }
  const msg =
    err?.type === "timeout"
      ? "Could not open the room – try again in a moment"
      : err?.type === "peer-unavailable"
      ? "Host not found – they should open Multiplayer and not refresh, then open the link again"
      : err?.type === "unavailable-id"
      ? "This room is taken – joining as a guest…"
      : "Connection error – check your network and open the link again";
  setLobbyStatus(msg, true);
}

function closeRoom() {
  stopHelloRetry();
  welcomed = false;
  mp.joining = false;
  mp.net?.destroy();
  mp.net = null;
  mp.roomId = "";
  mp.myId = "";
  mp.host = false;
  mp.hostId = "";
  mp.myReady = false;
  mp.myScore = 0;
  mp.wantPlay = false;
  mp.waiting = false;
  mp.inRound = false;
  mp.roundActive = false;
  mp.phase = "lobby";
  mp.goSent = false;
  mp.waitingGo = false;
  mp.lastGo = null;
  mp.truth = null;
  mp.snapped = new Set();
  mp.players.clear();
  mp.guesses.clear();
  mp.poses.clear();
  mp.seats = {};
  mp.snapInfo.clear();
  mp.rematch.clear();
  mp.launching = false;
  hideMpWait();
  mp.talkers.clear();
  destroyVoice();
  updateVoiceUi();
  setTabList(false);
  el.mpOnline?.classList.add("hidden");
  disposeAllMates();
}

let hostGen = 0;

function openHostLobby(existingId) {
  const gen = ++hostGen;
  closeRoom();
  mp.active = true;
  mp.host = true;
  mp.visibility = "private";
  mp.myName = normalizeNick(mp.myName) || savedNick() || "Host";
  syncRoomTitle();
  if (existingId) mp.roomId = existingId;
  selectLobbyMode("guess");
  showLobby();
  setLobbyStatus("Creating room…");
  const api = hostRoom(
    {
      onOpen(id, myId) {
        if (gen !== hostGen) return;
        mp.roomId = id;
        mp.myId = myId || api.myPeerId || id;
        mp.hostId = mp.myId;
        rememberHost(id);
        setRoomUrl(id);
        el.lobbyLink.value = roomLink(id);
        renderLobby();
        setLobbyStatus("Share the link — friends join this room");
      },
      onPeer: handlePeerJoined,
      onData: handleNetData,
      onCall: handleVoiceCall,
      onLeft: handlePeerLeft,
      onError: handleNetError,
    },
    existingId
  );
  attachNet(api);
}

function openGuestLobby(id) {
  hostGen += 1;
  closeRoom();
  mp.active = true;
  mp.host = false;
  mp.joining = true;
  mp.visibility = "private";
  mp.myName = normalizeNick(mp.myName) || savedNick() || randomUsername();
  mp.roomId = id;
  rememberJoin(id);
  showLobby();
  el.lobbyLink.value = roomLink(id);
  setLobbyStatus("Joining room…");
  setRoomUrl(id);
  const api = joinRoom(id, {
    onStatus(msg) {
      setLobbyStatus(msg);
    },
    onOpen(_hostId, myId) {
      if (myId) mp.myId = myId;
      startHelloRetry();
      renderLobby();
    },
    onPeer: handlePeerJoined,
    onData: handleNetData,
    onCall: handleVoiceCall,
    onLeft: handlePeerLeft,
    onError: handleNetError,
  });
  attachNet(api);
  startHelloRetry();
}

function tryStartMp() {}

async function launchMpRound() {
  if (!mp.host || mp.launching) return;
  if (!humansWantPlay()) return;
  mp.launching = true;
  mode = "guess";
  if (mp.wantPlay) mp.waiting = false;
  for (const p of mp.players.values()) {
    if (p.joined) p.waiting = false;
    p.ready = false;
  }
  el.lobbyStart.disabled = true;
  if (mp.wantPlay) showMpWait("Picking a new point…");
  try {
    const scopeInfo = GUESS_SCOPES[guessScope];
    setLobbyStatus(scopeInfo.status);
    const p = await pickGuessStart(guessScope);
    const nextScope = guessScope;
    const seats = buildSeats();
    mp.phase = "fly";
    timeLeft = GUESS_TIME;
    const msg = {
      t: "start",
      mode: "guess",
      lat: p.lat,
      lon: p.lon,
      scope: nextScope,
      seats,
      hostId: mp.myId,
      ...phasePayload(),
      ...regionPayload(),
    };
    mp.net?.send(msg);
    if (seats[mp.myId] != null) startMpFlight(msg);
    else {
      armRoundState(msg);
      mp.launching = false;
      hideMpWait();
      renderLobby();
    }
  } catch {
    mp.launching = false;
    hideMpWait();
    setLobbyStatus("Error – check your network and try again", true);
    el.lobbyStart.disabled = false;
  }
}

function buildSeats() {
  const seats = {};
  let i = 0;
  if (mp.wantPlay) seats[mp.myId] = i++;
  for (const p of otherPlayers()) {
    if (p.joined) seats[p.id] = i++;
  }
  return seats;
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function poseControl(value, fallback) {
  const input = Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : 0;
  return Math.max(-1, Math.min(1, input));
}

function pushMatePose(id, data) {
  const seq = data.seq ?? 0;
  let track = mp.poses.get(id);
  if (!track) {
    track = { seq: -1, samples: [], clockOff: null, plane: data.plane };
    mp.poses.set(id, track);
  }
  if (seq && seq <= track.seq) return;
  if (seq) track.seq = seq;
  if (data.plane) track.plane = data.plane;
  const localNow = performance.now();
  const senderAt = typeof data.at === "number" ? data.at : localNow;
  if (track.clockOff == null) track.clockOff = localNow - senderAt;
  else track.clockOff += (localNow - senderAt - track.clockOff) * 0.04;
  const last = track.samples[track.samples.length - 1];
  const at = Math.max(senderAt + track.clockOff, last ? last.at + 1 : 0);
  track.samples.push({
    at,
    lat: data.lat,
    lon: data.lon,
    h: data.h,
    heading: data.heading,
    pitch: data.pitch,
    roll: data.roll,
    kmh: Number.isFinite(data.kmh) ? Math.max(0, data.kmh) : 0,
    controlRoll: poseControl(data.controlRoll, -data.roll / 0.9),
    controlPitch: poseControl(data.controlPitch, data.pitch / 0.4),
    throttle: Number.isFinite(data.throttle) ? Math.max(0, Math.min(1, data.throttle)) : .6,
    airbrake: Number.isFinite(data.airbrake) ? Math.max(0, Math.min(1, data.airbrake)) : 0,
    tow: data.plane === "sailplane" ? parseTowSnapshot(data.tow) : null,
    dragonReleased: data.dragonReleased === true,
    booster: data.plane === "falcon9" ? parseBoosterSnapshot(data.booster) : null,
  });
  if (track.samples.length > 24)
    track.samples.splice(0, track.samples.length - 24);
}

function seedMatePose(id, lat, lon, h, planeKey) {
  if (!id || id === mp.myId) return;
  loadMate(id, planeKey || "pa28");
  mp.poses.set(id, {
    seq: -1,
    samples: [
      { at: performance.now(), lat, lon, h, heading: 0, pitch: 0, roll: 0 },
    ],
    clockOff: null,
    plane: planeKey,
  });
}

function seedAllMates(h) {
  const lat0 = mp.truth?.lat;
  const lon0 = mp.truth?.lon;
  if (lat0 == null || lon0 == null) return;
  const total = Object.keys(mp.seats).length || 1;
  for (const [id, seat] of Object.entries(mp.seats)) {
    if (id === mp.myId) continue;
    const spawn = offsetByIndex(lat0, lon0, Number(seat), total);
    seedMatePose(
      id,
      spawn.lat,
      spawn.lon,
      h,
      mp.players.get(id)?.plane || "pa28"
    );
  }
}

function offsetByIndex(lat, lon, index, total) {
  if (total <= 1) return { lat, lon };
  const spacingM = 12;
  const dE = (index - (total - 1) / 2) * spacingM;
  const R = 6378137;
  return {
    lat,
    lon: lon + (dE / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI),
  };
}

function markRoundStarted(seats) {
  mp.roundActive = true;
  mp.inRound = !!(seats && seats[mp.myId] != null);
  mp.waiting = mp.wantPlay && !mp.inRound;
  mp.myReady = false;
  for (const p of mp.players.values()) {
    p.ready = false;
    p.inRound = !!(seats && seats[p.id] != null);
    if (!p.joined) p.inRound = false;
  }
}

function armRoundState(msg) {
  mode = msg.mode || "guess";
  const nextScope = msg.scope || guessScope;
  if (nextScope !== guessScope) {
    geoCache = null;
    geoCacheScope = null;
  }
  guessScope = nextScope;
  mp.active = true;
  mp.guesses.clear();
  mp.poses.clear();
  mp.poseSeq = 0;
  mp.truth = { lat: msg.lat, lon: msg.lon };
  mp.seats = msg.seats || {};
  mp.snapped = new Set();
  mp.snapInfo.clear();
  mp.rematch.clear();
  mp.goSent = false;
  mp.waitingGo = false;
  mp.lastGo = null;
  mp.launching = false;
  mp.goAt = 0;
  guessAnswered = false;
  markRoundStarted(mp.seats);
  mp.phase = "fly";
  mp.markLeft = 0;
  mp.resultsLeft = 0;
  timeLeft = GUESS_TIME;
  if (mp.host) {
    broadcastRoster();
    const releaseIfSnapped = () => {
      if (!mp.host || !mp.roundActive || mp.goSent) return;
      if ([...mp.snapInfo.values()].some(isTerrainSnap)) applyGo();
    };
    setTimeout(releaseIfSnapped, 12000);
    setTimeout(releaseIfSnapped, 22000);
    if (mp.seats[mp.myId] == null) {
      setTimeout(() => {
        if (!mp.host || mp.goSent || !mp.roundActive) return;
        if ([...mp.snapInfo.values()].some(isTerrainSnap)) applyGo();
      }, 2500);
    }
  }
}

async function startMpFlight(msg) {
  armRoundState(msg);
  homeTarget =
    msg.homeLat != null ? { lat: msg.homeLat, lon: msg.homeLon } : null;
  timerActive = false;
  menuOpen = true;
  guessOpen = false;
  crashed = false;
  finished = false;
  el.guessmap.classList.remove("show");
  el.lobby.classList.add("hidden");
  hideBanner();
  el.lobbyStart.disabled = false;
  setLobbyStatus("Loading terrain… waiting for everyone");
  showMpWait("Loading terrain… waiting for everyone");
  const seat = mp.seats[mp.myId] ?? 0;
  const total = Object.keys(mp.seats).length || 1;
  const spawn = offsetByIndex(msg.lat, msg.lon, seat, total);
  if (selectedPlane !== planeMesh?.userData?.key) loadPlane(selectedPlane);
  beginFlight(spawn.lat, spawn.lon);
  seedAllMates(plane.height);
  if (mode === "home" && homeTarget)
    placeBeaconAt(homeTarget.lat, homeTarget.lon);
}

function reportSnapped() {
  if (!mp.active || !mp.inRound) return;
  if (mp.goSent && mp.lastGo) {
    applyGo({ ...mp.lastGo });
    return;
  }
  if (mp.goSent || mp.waitingGo) return;
  mp.waitingGo = true;
  setLobbyStatus("Waiting until everyone is ready…");
  showMpWait("Waiting until everyone is ready…");
  const info = {
    h: plane.height,
    gh: groundAlt,
    heading: 0,
    probed: snapLastGh !== null,
  };
  mp.snapInfo.set(mp.myId, info);
  mp.net?.send({ t: "snapped", from: mp.myId, ...info });
  if (mp.host) {
    mp.snapped.add(mp.myId);
    tryReleaseGo();
  }
}

function tryReleaseGo() {
  if (!mp.host || mp.goSent) return;
  const need = Object.keys(mp.seats || {});
  if (!need.length || !need.every((id) => mp.snapped.has(id))) return;
  if (![...mp.snapInfo.values()].some(isTerrainSnap)) return;
  applyGo();
}

function snapAgl() {
  return mode === "guess" ? 350 : 320;
}

function spawnHoldAlt() {
  if (mode === "guess") return guessHoldAlt(guessScope);
  return 6000;
}

function isTerrainSnap(s) {
  if (!s || !Number.isFinite(s.h) || !Number.isFinite(s.gh)) return false;
  if (s.probed === false) return false;
  if (Math.abs(s.h - s.gh - snapAgl()) > 100) return false;
  if (Math.abs(s.h - spawnHoldAlt()) < 300) return false;
  return true;
}

function buildGoPayload() {
  const snaps = [...mp.snapInfo.values()].filter(isTerrainSnap);
  if (!snaps.length) return null;
  const ghs = snaps.map((s) => s.gh).sort((a, b) => a - b);
  const gh = ghs[Math.floor(ghs.length / 2)];
  return { h: gh + snapAgl(), gh, heading: 0 };
}

function applyGo(msg) {
  const incoming =
    msg && Number.isFinite(Number(msg.h))
      ? {
          h: Number(msg.h),
          gh: Number.isFinite(Number(msg.gh))
            ? Number(msg.gh)
            : Number(msg.h) - snapAgl(),
          heading: msg.heading ?? 0,
        }
      : null;
  if (mp.goSent && !(mp.inRound && (menuOpen || awaitingSnap))) return;
  const payload = incoming ||
    mp.lastGo ||
    buildGoPayload() || { h: 850, gh: 500, heading: 0 };
  const alreadySent = mp.goSent;
  mp.goSent = true;
  mp.waitingGo = false;
  mp.lastGo = payload;
  if (mp.host && !alreadySent) mp.net?.send({ t: "go", ...payload });
  pendingSnap = false;
  awaitingSnap = false;
  armCrashGrace();
  if (plane && payload.h != null) {
    plane.height = payload.h;
    plane.heading = payload.heading ?? 0;
    plane.pitch = 0;
    plane.roll = 0;
    ctrl.roll = 0;
    ctrl.pitch = 0;
    groundAlt = payload.gh ?? payload.h - snapAgl();
  }
  camInit = false;
  mp.goAt = performance.now();
  mp.lastPoseAt = 0;
  seedAllMates(payload.h ?? plane.height);
  hideMpWait();
  if (mp.inRound) finishSnapStart();
}

function tickHostRound(dt) {
  if (!mp.active || !mp.host || !mp.roundActive || mp.launching || !mp.goSent) return;
  const selfClock = mp.inRound && (timerActive || guessOpen);
  if (!selfClock) {
    if (mp.phase === "fly") {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        mp.phase = "mark";
        mp.markLeft = MARK_TIME;
        mp.net?.send({ t: "phase", roundActive: true, ...phasePayload() });
      }
    } else if (mp.phase === "mark") {
      mp.markLeft -= dt;
      if (mp.markLeft <= 0) revealMpGuesses(true);
    } else if (mp.phase === "results") {
      mp.resultsLeft -= dt;
      if (mp.resultsLeft <= 0) {
        if (humansWantPlay()) launchMpRound();
        else {
          finishRoomRound();
          mp.phase = "lobby";
          broadcastRoster();
        }
      }
    }
  }
  if (mp.phase === "fly") mp.phaseLeft = timeLeft;
  else if (mp.phase === "mark") mp.phaseLeft = mp.markLeft;
  else if (mp.phase === "results") mp.phaseLeft = mp.resultsLeft;
  if (frameCount % 45 === 0) {
    mp.net?.send({ t: "phase", roundActive: true, ...phasePayload() });
    if (menuOpen) renderLobby();
  }
}

function leaveRound() {
  const wasIn = mp.inRound;
  mp.inRound = false;
  mp.wantPlay = false;
  mp.myReady = false;
  if (wasIn) mp.net?.send({ t: "done", from: mp.myId });
  if (mp.host) {
    if (mp.rematch.size) abortRematchToLobby();
    else checkRoundClear();
  }
}

function checkRoundClear() {
  if (!mp.host) return;
  if (humansInRound()) return;
  finishRoomRound();
  mp.phase = "lobby";
  mp.net?.send({ t: "roundEnd" });
  broadcastRoster();
}

function finishRoomRound() {
  mp.roundActive = false;
  mp.inRound = false;
  mp.waiting = false;
  mp.myReady = false;
  mp.goSent = false;
  mp.waitingGo = false;
  mp.lastGo = null;
  mp.truth = null;
  mp.seats = {};
  mp.snapped = new Set();
  for (const p of mp.players.values()) {
    p.waiting = false;
    p.inRound = false;
    p.ready = false;
  }
  mp.guesses.clear();
  mp.poses.clear();
  mp.snapInfo.clear();
  mp.rematch.clear();
  mp.launching = false;
  hideAllMates();
}

function showMpWait(text) {
  if (text) el.mpWaitText.textContent = text;
  el.mpWait.classList.remove("hidden");
}

function hideMpWait() {
  el.mpWait.classList.add("hidden");
}

function rematchNeeded() {
  return inRoundPlayers().map((p) => p.id);
}

function updateRematchWait() {
  if (!mp.rematch.has(mp.myId)) return;
  const need = rematchNeeded();
  const n = need.filter((id) => mp.rematch.has(id)).length;
  showMpWait(`Waiting for everyone to click… ${n}/${need.length || 1}`);
}

function requestRematch() {
  if (!mp.active || mp.rematch.has(mp.myId) || mp.launching) return;
  mp.rematch.add(mp.myId);
  mp.net?.send({ t: "rematch", from: mp.myId });
  hideBanner();
  el.gmRetry.style.display = "none";
  el.gmClose.style.display = "none";
  updateRematchWait();
  if (mp.host) tryLaunchRematch();
}

function tryLaunchRematch() {
  if (!mp.host || mp.launching) return;
  const need = rematchNeeded();
  if (!need.length || need.some((id) => !mp.rematch.has(id))) return;
  launchMpRound();
}

function abortRematchToLobby() {
  if (!mp.host) return;
  finishRoomRound();
  mp.net?.send({ t: "roundEnd" });
  broadcastRoster();
}

function backToLobby() {
  setLeaveOpen(false);
  hideBanner();
  menuOpen = true;
  timerActive = false;
  guessOpen = false;
  awaitingSnap = false;
  crashed = false;
  finished = false;
  beacon.visible = false;
  el.guessmap.classList.remove("show");
  leaveRound();
  if (planeMesh) planeMesh.visible = true;
  showLobby();
}

function setLobbyScope(scope, broadcast = false) {
  if (guessScope !== scope) {
    geoCache = null;
    geoCacheScope = null;
  }
  guessScope = scope;
  GUESS_SCOPES[guessScope]?.load().catch(() => {});
  document.querySelectorAll("#lobby-scopes .scope-btn").forEach((b) => {
    b.classList.toggle("selected", b.dataset.scope === scope);
  });
  syncRoomTitle();
  if (el.lobbyTitle) el.lobbyTitle.textContent = roomTitleFromParams();
  if (broadcast && mp.host && mp.net) {
    mp.net.send({ t: "scope", scope, title: mp.roomTitle, ...regionPayload() });
    renderLobby();
  }
}
document.querySelectorAll("#lobby-scopes .scope-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!mp.host) return;
    setLobbyScope(btn.dataset.scope, true);
  });
});
document.querySelectorAll("#lobby .mode-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!mp.host) return;
    selectLobbyMode(btn.dataset.mode, true);
  });
});
el.lobbyCity.addEventListener("input", () => {
  if (mp.host && mp.net) mp.net.send({ t: "city", city: el.lobbyCity.value });
});

function hasPlayableMap() {
  return !PUBLIC_MAP_LOCKED || !!getUserIonKey();
}

function syncMapLockUi() {
  const locked = PUBLIC_MAP_LOCKED && !getUserIonKey();
  el.mapLock?.classList.toggle("hidden", !locked);
  el.landing?.classList.toggle("hidden", locked);
  setMusicSuspended(locked);
}

function saveUserIonKey() {
  const raw = el.ionKeyInput?.value || "";
  const token = raw.trim();
  if (token.length < 16) {
    if (el.ionKeyStatus)
      el.ionKeyStatus.textContent = "That token looks too short.";
    return;
  }
  setUserIonKey(token);
  location.reload();
}

function needOwnMapKey() {
  if (hasPlayableMap()) return false;
  syncMapLockUi();
  el.ionKeyInput?.focus();
  return true;
}

syncMapLockUi();
el.ionKeySave?.addEventListener("click", saveUserIonKey);
el.ionKeyInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveUserIonKey();
  }
});

async function init() {
  if (tilePool.slots.length) {
    setLoader("Connecting to map…", 0.4);
    const ready = await tilePool.warmup();
    if (!ready) {
      loadError = PUBLIC_MAP_LOCKED
        ? "Could not open terrain with that token — check My Assets and the token"
        : "Map servers are busy — starting anyway, terrain will retry";
    }
  } else if (PUBLIC_MAP_LOCKED) {
    setLoader("Start…", 0.5);
  } else {
    setLoader("Missing map keys – add VITE_CESIUM_ION_KEYS to .env", 0);
    return;
  }
  setLoader("Start…", 0.4);

  try {
    scene = new Scene();
    scene.background = null;
    scene.fog = new FogExp2(0x9dd0ea, 0.00007);

    renderer = new WebGLRenderer({
      antialias: !isMobile,
      powerPreference: isMobile ? "default" : "high-performance",
      alpha: false,
    });
    renderer.setClearColor(0x8ec8e8);
    applyPixelRatio();
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = 4;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = !isMobile;
    renderer.shadowMap.type = 2; // PCFSoft
    renderer.domElement.id = "game-canvas";
    document.body.appendChild(renderer.domElement);
    vehicleGroundShadows = createVehicleGroundShadows(renderer, { mobile: isMobile });
    droneCannons = createDroneCannons(scene);
    fighterMissiles = createFighterMissiles(scene, {
      onImpact(position, up) {
        explosions.push(createExplosion(scene, position.clone().addScaledVector(up, .3), { up }));
        const distance = camera.position.distanceTo(position);
        if (distance < 1800) playExplosionSound(Math.max(.08, 1 - distance / 1800));
      },
    });

    ambientLight = new HemisphereLight(0xbfd8ee, 0x5a7048, 1.15);
    scene.add(ambientLight);
    sun = new DirectionalLight(0xfff2dd, 2.0);
    sun.castShadow = !isMobile;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 2500;
    sun.shadow.camera.left = -450;
    sun.shadow.camera.right = 450;
    sun.shadow.camera.top = 450;
    sun.shadow.camera.bottom = -450;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 2.0;
    scene.add(sun);
    scene.add(sun.target);

    camera = new PerspectiveCamera(70, innerWidth / innerHeight, 0.5, 1e8);

    tiles = new TilesRenderer();
    tiles.registerPlugin({
      name: "TILE_KEY_POOL_PLUGIN",
      priority: -100,
      tiles: null,
      init(t) {
        this.tiles = t;
      },
      fetchData(url, options) {
        const g = this.tiles.getPluginByName("GOOGLE_CLOUD_AUTH_PLUGIN");
        if (g?.auth) g.auth.autoRefreshToken = false;
        return tilePool
          .fetchData(url, options)
          .then((res) => {
            if (
              res &&
              (res.status === 429 || res.status === 403 || res.status === 401)
            ) {
              onTileThrottle(res.status);
            }
            return res;
          })
          .catch((err) => {
            lastTileErr = String(err?.message || err).slice(0, 220);
            pendingFailedRetry = true;
            return new Response("", { status: 599, statusText: lastTileErr });
          });
      },
    });
    const startSlot = tilePool.current;
    if (startSlot?.kind === "ion") {
      tiles.registerPlugin(
        new CesiumIonAuthPlugin({
          apiToken: startSlot.token,
          assetId: ION_GOOGLE_TILES_ASSET,
          autoRefreshToken: false,
          useRecommendedSettings: false,
        })
      );
    } else {
      tiles.registerPlugin(
        new GoogleCloudAuthPlugin({
          apiToken: startSlot?.token || tilePool.firstGoogleToken,
          useRecommendedSettings: false,
        })
      );
    }
    tilePool.onSwitch = () => {
      syncTileAuth(tiles, tilePool);
      applyTileQuality(tiles, isMobile);
      pendingFailedRetry = true;
    };
    tiles.registerPlugin(
      new TileCompressionPlugin({
        disableMipmaps: isMobile,
        compressIndex: true,
      })
    );
    tiles.registerPlugin(new UpdateOnChangePlugin());
    tiles.registerPlugin(createHoldParentTilesPlugin());
    tiles.registerPlugin(new UnloadTilesPlugin({ delay: 6000 }));
    tiles.registerPlugin(new TilesFadePlugin());
    const draco = new DRACOLoader();
    draco.setDecoderPath(
      "https://www.gstatic.com/draco/versioned/decoders/1.5.7/"
    );
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    tiles.group.rotation.x = -Math.PI / 2;
    tiles.group.visible = false;
    scene.add(tiles.group);
    airportRunways.attach(scene, tiles.group);
    liveTraffic = createLiveTraffic({ scene, camera, mapRoot: tiles.group, mobile: isMobile, baseUrl: import.meta.env.VITE_TRAFFIC_API_BASE || "" });
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.setCamera(camera);
    applyTileQuality(tiles, isMobile);
    const maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    tiles.addEventListener("load-model", ({ scene }) => {
      sharpenTileTextures(scene, isMobile ? Math.min(8, maxAniso) : maxAniso);
      terrainDayNight.add(scene);
      vehicleGroundShadows.addTerrain(scene);
    });
    tiles.addEventListener("dispose-model", ({ scene }) => vehicleGroundShadows.removeTerrain(scene));
    tiles.addEventListener("load-tileset", () => {
      applyTileQuality(tiles, isMobile);
      tilePool.rememberPluginSession(
        tiles.getPluginByName("GOOGLE_CLOUD_AUTH_PLUGIN"),
        tiles.rootURL
      );
      syncTileAuth(tiles, tilePool);
    });

    // czytelny komunikat zamiast wiecznego ładowania
    tiles.addEventListener("load-error", (ev) => {
      const msg = String(ev?.error?.message || ev?.error || "");
      lastTileErr = msg.slice(0, 220);
      pendingFailedRetry = true;
      if (/429|403|502|503|quota|resource_exhausted|too many/i.test(msg)) {
        const code = /403/.test(msg) ? 403 : 429;
        onTileThrottle(code);
      }
      if (!loaderDismissed) {
        loadError = tilePool.slots.length
          ? "Map servers are busy – retrying on the next key"
          : "Missing map keys – add VITE_CESIUM_ION_KEYS to .env";
      }
    });
    setTimeout(() => {
      if (!loaderDismissed && tiles.group.children.length === 0) {
        loadError = "The map is not loading… check VITE_CESIUM_ION_KEYS";
      }
    }, 20000);

    // niebo — proceduralna kopuła (gradient + słońce + chmury FBM),
    // horyzont = dokładnie kolor mgły, więc nie ma przerwy ani poświaty
    sky = createSky(0x9dd0ea, { physicalBodies: true });
    sky.mesh.traverse(o => o.layers.set(1));
    scene.add(sky.mesh);
    spaceScene = new SpaceScene(scene, renderer.domElement, { baseUrl: import.meta.env.BASE_URL, simple: isMobile });
    magnetosphere = createMagnetosphereOverlay();
    spaceScene.scene.add(magnetosphere.root);

    if (!isMobile) {
      new TextureLoader().load(asset("textures/sky_day.jpg"), (tex) => {
        tex.mapping = EquirectangularReflectionMapping;
        tex.colorSpace = SRGBColorSpace;
        scene.environment = tex;
      });
    }

    beacon = createBeacon();
    beacon.visible = false;
    scene.add(beacon);

    loadPlane(selectedPlane);
    resetFlight(startLat, startLon);
    if (planeMesh) planeMesh.visible = false;
    loaderDismissed = true;
    hideLoader();

    window.addEventListener("resize", onResize);
    renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      window.__ctxLost = true;
      liveTraffic?.reset();
      showFatal(
        "Graphics memory ran out on this phone (WebGL). Close other tabs and tap Start again, or use a computer."
      );
    });
    window.__game = {
      get planeMesh() {
        return planeMesh;
      },
      get plane() {
        return plane;
      },
      get camera() {
        return camera;
      },
      get spaceScene() {
        return spaceScene;
      },
    };
    window.__scene = scene;
    gameReady = true;
    clearStarting();
    if (
      /Phone closed the tab|out of memory|Light mode is on/i.test(lastError())
    ) {
      clearError();
    }
  } catch (err) {
    console.error(err);
    const msg =
      "This phone could not start the 3D engine. Try Safari or Chrome, or a computer.";
    setLoader(msg, 0);
    showFatal(err?.message ? `${msg} (${err.message})` : msg);
  }
}

function loadPlane(key) {
  const spec = PLANES[key];
  camOffset = spec.cam;
  if (planeMesh) {
    planeMesh.userData.landingGear?.dispose();
    droneCannons?.removeVehicle(planeMesh);
    fighterMissiles?.removeVehicle(planeMesh);
    vehicleGroundShadows?.removeVehicle(planeMesh);
    disposeRocketExhaust(planeMesh);
    disposeContrails(planeMesh);
    disposeVehicleVisuals(planeMesh);
    scene.remove(planeMesh);
  }
  planeMesh = createPlaneMesh(); // fallback na czas ładowania
  flightCamera.setModel(planeMesh);
  planeMesh.userData.key = key;
  applyRotorState(planeMesh, true);
  scene.add(planeMesh);
  const placeholder = planeMesh;

  loadVehicleModel(spec).then((model) => {
    if (planeMesh !== placeholder) {
      disposeModelResources(model);
      return;
    }
    if (spec.prepare) spec.prepare(model); // np. poza czarownicy + miotła
    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    model.scale.setScalar(spec.wingspan / Math.max(size.x, size.y, size.z));
    box.setFromObject(model);
    model.position.sub(box.getCenter(new Vector3()));
    finishVehicleMaterials(model);
    flightCamera.setModel(model, { vertical: spec.vertical, basket: spec.flightModel === "balloon" });
    const wrapper = new Group();
    wrapper.add(model);
    const gear = attachLandingGear(wrapper, model, key);
    if (gear && !gear.fixed && mode !== "landing") gear.extension = gear.target = 0;
    wrapper.userData.prop = null;
    wrapper.userData.key = key;
    applyRotorState(wrapper, true);
    if (spec.exhaust) attachRocketExhaust(wrapper, spec.exhaustOptions);
    if (!spec.vertical && !spec.noContrails) attachContrails(wrapper, scene, spec.contrailOptions);
    vehicleGroundShadows?.addVehicle(wrapper);
    scene.remove(planeMesh);
    disposeModelResources(placeholder);
    planeMesh = wrapper;
    scene.add(planeMesh);
  }).catch((err) => {
    console.error(`Could not load vehicle ${key}`, err);
  });
}

function disposeMate(id) {
  const mate = mp.mates.get(id);
  mate?.towVisuals?.dispose();
  droneCannons?.removeVehicle(mate?.mesh);
  lastDroneBurstSeq.delete(id);
  fighterMissiles?.removeVehicle(mate?.mesh);
  lastMissileShotSeq.delete(id);
  vehicleGroundShadows?.removeVehicle(mate?.mesh);
  disposeRocketExhaust(mate?.mesh);
  disposeContrails(mate?.mesh);
  disposeVehicleVisuals(mate?.mesh);
  if (mate?.mesh && scene) scene.remove(mate.mesh);
  if (mate?.marker && scene) scene.remove(mate.marker);
  mp.mates.delete(id);
}

function disposeAllMates() {
  for (const id of [...mp.mates.keys()]) disposeMate(id);
}

function hideAllMates() {
  for (const mate of mp.mates.values()) {
    mate.towVisuals?.dispose();
    if (mate.mesh) mate.mesh.visible = false;
    if (mate.marker) mate.marker.visible = false;
  }
}

function createMateMarker() {
  const g = new Group();
  const mat = new MeshBasicMaterial({ color: 0xffd34d, depthTest: false });
  const shaft = new Mesh(new CylinderGeometry(0.45, 0.45, 9, 7), mat);
  shaft.position.y = 6;
  const head = new Mesh(new ConeGeometry(2.6, 5.5, 7), mat);
  head.rotation.x = Math.PI;
  head.position.y = -1.2;
  g.add(shaft, head);
  g.visible = false;
  g.renderOrder = 10;
  scene.add(g);
  return g;
}

function ensureMateMarker(mate) {
  if (!mate.marker && scene) mate.marker = createMateMarker();
  return mate.marker;
}

function loadMate(id, key) {
  if (!id || !key || !PLANES[key] || !scene) return;
  const prev = mp.mates.get(id);
  if (prev?.key === key && prev.mesh) return;
  disposeMate(id);
  const spec = PLANES[key];
  const placeholder = createPlaneMesh();
  applyRotorState(placeholder, true);
  placeholder.visible = false;
  scene.add(placeholder);
  mp.mates.set(id, { mesh: placeholder, key });
  loadVehicleModel(spec).then((model) => {
    const cur = mp.mates.get(id);
    if (!cur || cur.mesh !== placeholder) {
      disposeModelResources(model);
      return;
    }
    if (spec.prepare) spec.prepare(model);
    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    model.scale.setScalar(spec.wingspan / Math.max(size.x, size.y, size.z));
    box.setFromObject(model);
    model.position.sub(box.getCenter(new Vector3()));
    finishVehicleMaterials(model);
    const wrapper = new Group();
    wrapper.add(model);
    wrapper.userData.key = key;
    wrapper.visible = cur.mesh.visible;
    applyRotorState(wrapper, true);
    if (spec.exhaust) attachRocketExhaust(wrapper, spec.exhaustOptions);
    if (!spec.vertical && !spec.noContrails) attachContrails(wrapper, scene, spec.contrailOptions);
    vehicleGroundShadows?.addVehicle(wrapper);
    scene.remove(cur.mesh);
    disposeModelResources(placeholder);
    scene.add(wrapper);
    mp.mates.set(id, { mesh: wrapper, key, marker: cur.marker, towVisuals: cur.towVisuals });
  }).catch((err) => {
    console.error(`Could not load peer vehicle ${key}`, err);
  });
}

function resetFlight(latDeg, lonDeg) {
  falconStageInput.reset();
  sailplaneTow.reset(); grassLanding.reset();
  toggleSpaceMap(false);
  spaceTime = 0;
  document.getElementById("space-warp").value = "1";
  landingSystem.reset();
  if (mode === "landing" || landingSystem.runway.isGrass) landingSystem.runway = airportRunways.get(selectedApproach);
  planeMesh?.userData.landingGear?.reset();
  if (planeMesh?.userData.landingGear && !planeMesh.userData.landingGear.fixed && mode !== "landing") planeMesh.userData.landingGear.extension = planeMesh.userData.landingGear.target = 0;
  landingBrake = false;
  liveTraffic?.reset();
  const spec = PLANES[selectedPlane];
  droneCannons?.reset();
  lastDroneBurstSeq.clear();
  fighterMissiles?.reset();
  lastMissileShotSeq.clear();
  for (const explosion of explosions) explosion.dispose();
  explosions.length = 0;
  timeLeft = mode === "home" ? HOME_TIME : mode === "guess" ? GUESS_TIME : 0;
  timerActive = false;
  startLat = latDeg;
  startLon = lonDeg;
  // wysoki spawn poza nizinną Polską, żeby nie trafić w góry zanim teren się zmierzy
  // (menu i tak zostaje do czasu dosadzenia — spawn jest niewidoczny)
  const spawnAlt = mode === "guess" ? guessHoldAlt(guessScope) : 6000;
  resetFalcon9(planeMesh);
  plane = createVehicleController(latDeg, lonDeg, spawnAlt, 0, spec);
  groundAlt = TERRAIN_ALT;
  pendingSnap = true; // udany, ustabilizowany pomiar terenu dosadzi samolot na właściwą wysokość
  snapLastGh = null;
  snapBestGh = null;
  snapStableCount = 0;
  snapFirstAt = 0;
  lastSurf = null;
  crashed = false;
  crashGraceUntil = 0;
  finished = false;
  shake = 0;
  ctrl.roll = 0;
  ctrl.pitch = 0;
  throttleLever = plane.cruiseT;
  throttleShown = throttleLever;
  ctrl.throttle = throttleShown;
  syncThrottleUi();
  camInit = false;
  if (planeMesh) planeMesh.visible = true;
  homePath.length = 0;
  hideBanner();
}

function applyPixelRatio() {
  if (!renderer) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isMobile ? 1.25 : 2));
}

function sharpenTileTextures(root, anisotropy) {
  if (!root) return;
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of list) {
      if (!mat) continue;
      for (const key in mat) {
        const tex = mat[key];
        if (!tex || !tex.isTexture || tex.userData.foeSharp) continue;
        tex.userData.foeSharp = true;
        tex.anisotropy = isMobile ? Math.min(4, anisotropy) : anisotropy;
        if (isMobile) {
          tex.generateMipmaps = false;
          tex.minFilter = LinearFilter;
        } else {
          tex.generateMipmaps = true;
          tex.minFilter = LinearMipmapLinearFilter;
        }
        tex.magFilter = LinearFilter;
        tex.needsUpdate = true;
      }
    }
  });
}

function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyPixelRatio();
  renderer.setSize(innerWidth, innerHeight);
}

function frameAt(lat, lon, height, az, elv, roll) {
  const m = new Matrix4();
  WGS84_ELLIPSOID.getObjectFrame(
    lat,
    lon,
    height,
    az,
    elv,
    roll,
    m,
    CAMERA_FRAME
  );
  m.premultiply(tiles.group.matrixWorld);
  return m;
}

const _probeOrigin = new Vector3();
const _probeDir = new Vector3();
const _probePoint = new Vector3();
const _probeInv = new Matrix4();
const _probeLla = {};

function collectProbeHits(lat, lon, refHeight) {
  if (!tiles) return [];
  WGS84_ELLIPSOID.getCartographicToPosition(
    lat,
    lon,
    refHeight + 100,
    _probeOrigin
  );
  _probeOrigin.applyMatrix4(tiles.group.matrixWorld);
  WGS84_ELLIPSOID.getCartographicToNormal(lat, lon, _probeDir);
  _probeDir.transformDirection(tiles.group.matrixWorld).negate();
  raycaster.set(_probeOrigin, _probeDir);
  raycaster.far = refHeight + 2500;
  const prevFirst = raycaster.firstHitOnly;
  raycaster.firstHitOnly = false;
  const hits = raycastTerrain(raycaster, tiles.group);
  raycaster.firstHitOnly = prevFirst;
  return hits;
}

function hitEllipsoidHeight(hit) {
  _probePoint.copy(hit.point).applyMatrix4(_probeInv);
  WGS84_ELLIPSOID.getPositionToCartographic(_probePoint, _probeLla);
  return _probeLla.height;
}

function probeColumn(lat, lon, refHeight) {
  const hits = collectProbeHits(lat, lon, refHeight);
  if (!hits.length) return { surface: null, ground: null };
  _probeInv.copy(tiles.group.matrixWorld).invert();
  const surface = hitEllipsoidHeight(hits[0]);
  let ground = Infinity;
  const n = Math.min(hits.length, 12);
  for (let i = 0; i < n; i++) {
    const h = hitEllipsoidHeight(hits[i]);
    if (h < ground) ground = h;
  }
  return {
    surface: Number.isFinite(surface) ? surface : null,
    ground: Number.isFinite(ground) ? ground : null,
  };
}

// Pierwszy hit z nieba = widoczna powierzchnia (dach / szczyt).
function probeSurface(lat, lon, refHeight) {
  return probeColumn(lat, lon, refHeight).surface;
}

function probeGround(lat, lon, refHeight) {
  return probeColumn(lat, lon, refHeight).ground;
}

function tilesBusy() {
  if (!tiles) return true;
  if (tiles.isLoading) return true;
  const s = tiles.stats;
  if (!s) return false;
  return (
    (s.downloading || 0) > 0 || (s.queued || 0) > 0 || (s.parsing || 0) > 0
  );
}

function adoptGround(gh) {
  groundAlt = gh;
}

function armCrashGrace(ms = 2500) {
  crashGraceUntil = performance.now() + ms;
}

const vehicleCollision = createVehicleCollisionDetector();
const _flightFrom = new Vector3();
const _flightTo = new Vector3();
const _flightUp = new Vector3();
const _flightInv = new Matrix4();
const _flightLla = {};

function flightPosition(target) {
  return earthPosition(plane.lat, plane.lon, plane.height, tiles.group.matrixWorld, target);
}

function stopAtImpact(hit) {
  _flightInv.copy(tiles.group.matrixWorld).invert();
  _flightTo.copy(hit.position).applyMatrix4(_flightInv);
  WGS84_ELLIPSOID.getPositionToCartographic(_flightTo, _flightLla);
  plane.lat = _flightLla.lat;
  plane.lon = _flightLla.lon;
  plane.height = _flightLla.height;
  planePos.copy(hit.position);
  crash(hit.point);
}

function updateFlightPhysics(dt) {
  const canCrash = !pendingSnap && !awaitingSnap && performance.now() > crashGraceUntil;
  const radius = plane.collisionRadius ?? PLANES[selectedPlane].collisionRadius ?? (PLANES[selectedPlane].vertical ? 18 : 4.5);
  if (plane.isLunar) {
    if (canCrash) flightPosition(_flightFrom);
    plane.update(dt, ctrl);
    if (!canCrash) return;
    if (plane.spaceStatus?.startsWith("impact-")) { flightPosition(planePos); crash(planePos); return; }
    if (plane.height < 100000) {
      flightPosition(_flightTo);
      WGS84_ELLIPSOID.getCartographicToNormal(plane.lat, plane.lon, _flightUp);
      _flightUp.transformDirection(tiles.group.matrixWorld);
      const hit = vehicleCollision.sweep(tiles.group, _flightFrom, _flightTo, _flightUp, radius);
      if (hit) stopAtImpact(hit);
    }
    return;
  }
  let left = dt;
  while (left > 0) {
    const step = Math.min(1 / 60, left);
    if (canCrash && landingSystem?.gear && landingSystem.grounded) {
      if (landingSystem.runway.isGrass && grassLanding.reason) { flightPosition(planePos); crash(planePos); return; }
      const result = plane.isSailplane && sailplaneTow.attached ? sailplaneTow.step(step, plane, landingSystem) : landingSystem.roll(plane, step, ctrl);
      left -= step;
      if (result.crash) { flightPosition(planePos); crash(planePos); return; }
      continue;
    }
    const before = landingSystem?.gear ? flightPose(plane) : null;
    if (canCrash) flightPosition(_flightFrom);
    if (plane.isSailplane && sailplaneTow.attached) sailplaneTow.step(step, plane, landingSystem);
    else plane.update(step, ctrl);
    left -= step;
    if (canCrash) {
      if (before) {
        const result = landingSystem.resolve(plane, before, step);
        if (result.crash) { flightPosition(planePos); crash(planePos); return; }
        if (result.handled) continue;
      }
      flightPosition(_flightTo);
      WGS84_ELLIPSOID.getCartographicToNormal(plane.lat, plane.lon, _flightUp);
      _flightUp.transformDirection(tiles.group.matrixWorld);
      const hit = vehicleCollision.sweep(tiles.group, _flightFrom, _flightTo, _flightUp, radius);
      if (hit) {
        stopAtImpact(hit);
        return;
      }
    }
  }
  if (!canCrash) return;
  if (landingSystem?.grounded || landingSystem?.protects(plane)) { const runway = landingSystem.runway; groundAlt = runway.pose(0, -runway.coordinates(plane).z).height; return; }
  // Recheck this location, not an old altitude from another tile. This also
  // catches penetration when terrain arrives during the brief spawn grace.
  const col = probeColumn(plane.lat, plane.lon, Math.max(plane.height, 2500));
  if (col.ground === null) return;
  adoptGround(col.ground);
  if (plane.height - col.ground <= radius) {
    plane.height = col.ground + radius;
    flightPosition(planePos);
    WGS84_ELLIPSOID.getCartographicToNormal(plane.lat, plane.lon, _flightUp);
    _flightUp.transformDirection(tiles.group.matrixWorld);
    crash(planePos.clone().addScaledVector(_flightUp, -radius));
  }
}

function crash(point = planePos) {
  if (crashed) return;
  crashed = true;
  sailplaneTow.reset();
  const up = WGS84_ELLIPSOID.getCartographicToNormal(plane.lat, plane.lon, new Vector3())
    .transformDirection(tiles.group.matrixWorld);
  explosions.push(createExplosion(scene, point.clone(), { up }));
  playExplosionSound();
  shake = 1;
  if (planeMesh) planeMesh.visible = false;
  if (mode === "home" && plane)
    homePath.push({ lat: plane.latDeg, lon: plane.lonDeg });
  if (mp.active && mode === "guess") return; // runda trwa — po minucie i tak zgadujecie
  timerActive = false;
  setTimeout(() => showBanner("YOU CRASHED"), 900);
}

async function geocodeCity(name) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(name);
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error("http " + res.status);
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

let placeReq = 0;
let lastPlaceAt = 0;
let lastPlaceLat = 0;
let lastPlaceLon = 0;

function placeNameFromReverse(data) {
  const a = data?.address || {};
  return (
    a.city ||
    a.town ||
    a.village ||
    a.hamlet ||
    a.municipality ||
    a.suburb ||
    data?.name ||
    a.county ||
    a.state ||
    ""
  );
}

function hidePlaceBadge() {
  el.placeBox?.classList.remove("show");
  if (el.place) el.place.textContent = "–";
}

function syncPlaceBadge() {
  if (plane?.height >= 100000) { hidePlaceBadge(); return; }
  if (mode !== "free" || menuOpen || guessOpen || !plane) {
    if (mode !== "free" || menuOpen) hidePlaceBadge();
    return;
  }
  const now = performance.now();
  const moved = lastPlaceAt
    ? distanceM(plane.latDeg, plane.lonDeg, lastPlaceLat, lastPlaceLon)
    : 1e9;
  if (lastPlaceAt && now - lastPlaceAt < 5500 && moved < 2200) return;
  lastPlaceAt = now;
  lastPlaceLat = plane.latDeg;
  lastPlaceLon = plane.lonDeg;
  const token = ++placeReq;
  const url =
    "https://nominatim.openstreetmap.org/reverse?format=json&zoom=12&lat=" +
    plane.latDeg +
    "&lon=" +
    plane.lonDeg;
  fetch(url, { headers: { Accept: "application/json" } })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (token !== placeReq || mode !== "free" || menuOpen || plane.height >= 100000) return;
      const name = placeNameFromReverse(data);
      if (!name) return;
      if (el.place) el.place.textContent = name;
      el.placeBox?.classList.add("show");
    })
    .catch(() => {});
}

function placeBeaconAt(latDeg, lonDeg) {
  const gh = probeSurface(
    latDeg * (Math.PI / 180),
    lonDeg * (Math.PI / 180),
    2500
  );
  const base = gh !== null ? gh : TERRAIN_ALT;
  beaconGrounded = gh !== null;
  const m = frameAt(
    latDeg * (Math.PI / 180),
    lonDeg * (Math.PI / 180),
    base,
    0,
    0,
    0
  );
  m.decompose(beacon.position, beacon.quaternion, beacon.scale);
}

// --- start gry ---
async function startGame() {
  if (!menuOpen || el.start.disabled || awaitingSnap) return;
  if (needOwnMapKey()) return;
  if (!gameReady || !tiles || !plane) {
    return menuFail("Still loading – tap Start again in a moment");
  }
  el.start.disabled = true;
  el.menuError.textContent = "";
  try {
    if (mode === "landing") {
      if (!LANDING_SPEEDS[selectedPlane]) return menuFail("Choose an aircraft with landing gear: Piper, Sailplane, Q400, Citation, 737, A320 or Fighter.");
      const runway = airportRunways.get(selectedApproach);
      const p = runway.pose(0, runway.definition.threshold - 6000, 340);
      beginFlight(p.lat * 180 / Math.PI, p.lon * 180 / Math.PI);
    } else if (mode === "free") {
      const city = el.city.value.trim() || "Niepruszewo";
      el.menuError.textContent = `Looking up: ${city}…`;
      const loc = await geocodeCity(city);
      if (!loc) return menuFail(`Could not find “${city}”`);
      beginFlight(loc.lat, loc.lon);
    } else if (mode === "home") {
      const addr = el.city.value.trim();
      if (!addr) return menuFail("Enter your address");
      el.menuError.textContent = "Looking up address…";
      const loc = await geocodeCity(addr);
      if (!loc) return menuFail("Could not find that address");
      homeTarget = loc;
      const start = offsetPoint(loc.lat, loc.lon, 20 + Math.random() * 10);
      beginFlight(start.lat, start.lon);
      placeBeaconAt(loc.lat, loc.lon);
    } else {
      el.menuError.textContent = GUESS_SCOPES[guessScope].status;
      const p = await pickGuessStart(guessScope);
      beginFlight(p.lat, p.lon);
    }
  } catch (err) {
    console.error(err);
    menuFail("Could not start – try again, or use a stronger connection");
  }
}

function menuFail(msg) {
  el.menuError.textContent = msg;
  el.start.disabled = false;
  rememberError(msg);
}

function sleepPreviews() {
  carousel.setActive(false);
  lobbyCarousel.setActive(false);
}

function beginFlight(lat, lon) {
  menuOpen = true;
  markStarting();
  sleepPreviews();
  el.menuError.textContent = "Loading terrain…";
  if (selectedPlane !== planeMesh?.userData?.key) loadPlane(selectedPlane);
  resetFlight(lat, lon);
  retryFailedTiles(true);
  el.timerBox.classList.toggle("show", mode === "home" || mode === "guess");
  el.distBox.classList.remove("show");
  lastPlaceAt = 0;
  hidePlaceBadge();
  // menu zostaje we wszystkich trybach — gracz nie widzi wysokiego spawnu,
  // a samolot nie jest szarpany dosadzeniem w trakcie sterowania
  awaitingSnap = true;
  awaitingSnapSince = performance.now();
}

// wywoływane gdy teren zmierzony — właściwy start gry
function finishSnapStart() {
  if (mode === "landing") {
    const runway = airportRunways.get(selectedApproach);
    landingSystem.runway = runway;
    runway.calibrate(probeSurface, { force: true, distance: 6000 });
    const clearance = Math.max(0, ...(planeMesh?.userData.landingGear?.points() || []).map(w => -w.point.y));
    Object.assign(plane, runway.pose(0, runway.definition.threshold - 6000, (6000 + runway.definition.aimingPoint) * Math.tan(3 * Math.PI / 180) + clearance));
    plane.heading = runway.definition.heading * Math.PI / 180;
    plane.speed = LANDING_SPEEDS[selectedPlane];
    plane.verticalSpeed = -plane.speed * Math.sin(3 * Math.PI / 180);
    plane.pitch = plane.roll = 0;
    plane.throttle = plane.isSailplane ? 0 : (plane.speed - plane.speed * .55) / (plane.boost - plane.speed * .55);
    // Partial spoilers put the glider on the prepared three-degree approach.
    if (plane.isSailplane) plane.airbrake = .35;
    throttleLever = throttleShown = plane.isSailplane ? plane.airbrake : plane.throttle;
    ctrl.throttle = plane.throttle;
    syncThrottleUi(); camInit = false;
  }
  // Start with the full mode duration only after the terrain is ready, even
  // when this flight was restarted or entered through a different start path.
  timeLeft = mode === "home" ? HOME_TIME : mode === "guess" ? GUESS_TIME : 0;
  paused = false;
  hideBanner();
  if (el.menu.contains(document.activeElement)) document.activeElement.blur();
  menuOpen = false;
  guessOpen = false;
  guessAnswered = false;
  el.menu.classList.add("hidden");
  el.landing.classList.add("hidden");
  el.lobby.classList.add("hidden");
  el.guessmap.classList.remove("show");
  el.menuError.textContent = "";
  carousel.setActive(false);
  hideMpWait();
  el.start.disabled = false;
  timerActive = mode === "guess" || mode === "home";
  clearError();
  updateMpPresence();
  if (mode === "free") {
    lastPlaceAt = 0;
    syncPlaceBadge();
  } else {
    hidePlaceBadge();
  }
  setTimeout(clearStarting, 2500);
  armCrashGrace();
  syncGuessHud();
}

function unlockAudio() {
  try {
    primeAudio();
    primeMusic();
  } catch {
    /* iOS can reject AudioContext; flight still works */
  }
}

function syncMusicButtons() {
  const label = musicEnabled() ? "Music: On" : "Music: Off";
  document.querySelectorAll(".music-btn").forEach((btn) => {
    btn.textContent = label;
  });
}
syncMusicButtons();
document.querySelectorAll(".music-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setMusicEnabled(!musicEnabled());
    syncMusicButtons();
  });
});

window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

el.start.addEventListener("click", () => {
  unlockAudio();
  startGame();
});
el.city.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startGame();
});

el.btnSolo.addEventListener("click", () => {
  if (needOwnMapKey()) return;
  unlockAudio();
  showSoloMenu();
});
el.btnMulti.addEventListener("click", () => {
  if (needOwnMapKey()) return;
  unlockAudio();
  const nick = savedNick();
  if (nick) {
    mp.myName = nick;
    openHostLobby();
    return;
  }
  showNick();
});
el.nickBack?.addEventListener("click", () => showLanding());
el.nickGo?.addEventListener("click", () => {
  unlockAudio();
  submitNick();
});
el.nickInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    unlockAudio();
    submitNick();
  }
});
el.menuBack.addEventListener("click", () => showLanding());
el.lobbyBack.addEventListener("click", () => showLanding());
el.lobbyCopy.addEventListener("click", async () => {
  const link = el.lobbyLink.value;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    el.lobbyCopy.classList.add("copied");
    el.lobbyCopy.setAttribute("aria-label", "Copied");
    el.lobbyCopy.title = "Copied";
    setTimeout(() => {
      el.lobbyCopy.classList.remove("copied");
      el.lobbyCopy.setAttribute("aria-label", "Copy link");
      el.lobbyCopy.title = "Copy link";
    }, 1600);
  } catch {
    el.lobbyLink.select();
  }
});
function admitPlayer(id) {
  if (!mp.host) return;
  const p = id && mp.players.get(id);
  if (p) p.joined = true;
  if (mp.launching) {
    broadcastRoster();
    return;
  }
  if (isRoundLive() && mp.truth && mp.phase === "fly") {
    if (p) {
      p.waiting = false;
      p.inRound = true;
    }
    if (id && mp.seats[id] == null) mp.seats[id] = Object.keys(mp.seats).length;
    if (id) {
      mp.net.sendTo(id, {
        t: "start",
        mode: "guess",
        lat: mp.truth.lat,
        lon: mp.truth.lon,
        scope: guessScope,
        seats: mp.seats,
        hostId: mp.myId,
        ...phasePayload(),
        ...regionPayload(),
      });
      if (mp.lastGo) mp.net.sendTo(id, { t: "go", ...mp.lastGo });
    }
    broadcastRoster();
    return;
  }
  if (isRoundLive()) {
    if (p) p.waiting = true;
    broadcastRoster();
    return;
  }
  if (p) p.waiting = false;
  finishRoomRound();
  mp.phase = "lobby";
  if (!mp.launching) launchMpRound();
}

function joinCurrentFlight() {
  if (!mp.truth) {
    launchMpRound();
    return;
  }
  mp.wantPlay = true;
  mp.inRound = true;
  mp.roundActive = true;
  mp.waiting = false;
  if (mp.seats[mp.myId] == null)
    mp.seats[mp.myId] = Object.keys(mp.seats).length;
  const total = Object.keys(mp.seats).length || 1;
  const spawn = offsetByIndex(
    mp.truth.lat,
    mp.truth.lon,
    mp.seats[mp.myId],
    total
  );
  menuOpen = true;
  guessOpen = false;
  el.lobby.classList.add("hidden");
  showMpWait("Loading terrain…");
  if (selectedPlane !== planeMesh?.userData?.key) loadPlane(selectedPlane);
  beginFlight(spawn.lat, spawn.lon);
  seedAllMates(plane.height);
  broadcastRoster();
}

function requestPlay() {
  if (!mp.active) return;
  if (isLocallyFlying()) return;
  mp.wantPlay = true;
  mp.myReady = true;
  if (mp.joining || mp.launching) {
    renderLobby();
    return;
  }
  if (mp.host) {
    if (isRoundLive() && mp.truth && mp.phase === "fly" && !isLocallyFlying())
      joinCurrentFlight();
    else if (isRoundLive()) {
      mp.waiting = true;
      broadcastRoster();
    } else {
      mp.waiting = false;
      finishRoomRound();
      mp.phase = "lobby";
      launchMpRound();
    }
  } else {
    mp.waiting = false;
    mp.net?.send({ t: "join", from: mp.myId, plane: selectedPlane });
  }
  renderLobby();
}

el.lobbyStart.addEventListener("click", () => {
  unlockAudio();
  requestPlay();
});

const joinId = parseRoomFromUrl() || savedJoin();
if (joinId) showNick({ roomId: joinId });

function syncPauseCopy() {
  if (mp.active) {
    if (el.pauseTitle) el.pauseTitle.textContent = "Leave match?";
    if (el.pauseSub) {
      el.pauseSub.textContent =
        humansInRound() && otherPlayers().some((p) => p.inRound)
          ? "The round keeps going for everyone else."
          : "You can join again from the lobby.";
    }
    el.resume.textContent = "Continue";
    el.restart.textContent = "Leave";
  } else {
    if (el.pauseTitle) el.pauseTitle.textContent = "Paused";
    if (el.pauseSub) el.pauseSub.textContent = "";
    el.resume.textContent = "Continue";
    el.restart.textContent = "Start over";
  }
}

function setLeaveOpen(v) {
  falconStageInput.reset();
  leaveOpen = v;
  paused = false;
  keys.clear();
  syncPauseCopy();
  el.pause.classList.toggle("show", v);
}

function setPaused(v) {
  falconStageInput.reset();
  if (mp.active) {
    setLeaveOpen(v);
    return;
  }
  leaveOpen = false;
  paused = v;
  landingBrake = false;
  keys.clear();
  if (v) {
    freeMap.hide();
    miniMap.hide();
    hideMapNote();
  }
  syncGuessHud();
  syncPauseCopy();
  el.pause.classList.toggle("show", v);
}

el.resume.addEventListener("click", () => {
  if (mp.active) setLeaveOpen(false);
  else setPaused(false);
});
el.restart.addEventListener("click", () => {
  if (mp.active) {
    setLeaveOpen(false);
    backToLobby();
    return;
  }
  setPaused(false);
  backToMenu();
});

function backToMenu() {
  hideBanner();
  menuOpen = true;
  timerActive = false;
  guessOpen = false;
  awaitingSnap = false;
  beacon.visible = false;
  freeMap.hide();
  miniMap.hide();
  hideMapNote();
  el.guessmap.classList.remove("show");
  hidePlaceBadge();
  el.start.disabled = false;
  el.menuError.textContent = "";
  el.landing.classList.add("hidden");
  el.lobby.classList.add("hidden");
  el.menu.classList.remove("hidden");
  carousel.setActive(true);
  syncGuessHud();
}

// --- mapa zgadywania ---
function guessGeoReady() {
  return !!(geoCache?.features?.length && geoCacheScope === guessScope);
}

function drawGuessMap(marks = [], tries = 0) {
  if (!guessGeoReady()) return;
  const canvas = el.gmCanvas;
  if (
    canvas &&
    (canvas.clientWidth < 8 || canvas.clientHeight < 8) &&
    tries < 12
  ) {
    requestAnimationFrame(() => drawGuessMap(marks, tries + 1));
    return;
  }
  GUESS_SCOPES[guessScope].draw(canvas, geoCache, marks);
}

function loadGuessGeo() {
  if (guessGeoReady()) return Promise.resolve(geoCache);
  const scope = guessScope;
  const id = ++geoLoadId;
  return GUESS_SCOPES[scope].load().then((g) => {
    if (id !== geoLoadId || guessScope !== scope) return geoCache;
    if (!g?.features?.length) throw new Error("empty map");
    geoCache = g;
    geoCacheScope = scope;
    return g;
  });
}

function openGuessMap() {
  guessOpen = true;
  guessAnswered = false;
  keys.clear();
  el.gmResult.textContent = "";
  updateGuessScores();
  el.gmClose.style.display = "none";
  el.gmRetry.style.display = "none";
  el.gmClose.textContent = mp.active ? "Back to room" : "Back to menu";
  el.gmRetry.textContent = mp.active ? "Another round" : "Try again";
  if (mp.active) {
    mp.phase = "mark";
    mp.markLeft = MARK_TIME;
    if (el.gmTitle) el.gmTitle.textContent = "Where are you?";
    el.gmSub.textContent = "You have 10 seconds to mark the map";
  } else {
    if (el.gmTitle) el.gmTitle.textContent = "Where are you?";
    if (el.gmTimer) el.gmTimer.textContent = "";
    el.gmSub.textContent = GUESS_SCOPES[guessScope].sub;
  }
  updateGuessPhaseUi();
  el.guessmap.classList.add("show");
  syncGuessHud();
  const draw = () => requestAnimationFrame(() => drawGuessMap());
  if (guessGeoReady()) {
    draw();
    return;
  }
  el.gmSub.textContent = "Loading map…";
  loadGuessGeo()
    .then(() => {
      if (mp.active && mp.phase === "mark") {
        el.gmSub.textContent = "You have 10 seconds to mark the map";
      } else if (!mp.active) {
        el.gmSub.textContent = GUESS_SCOPES[guessScope].sub;
      }
      draw();
    })
    .catch(() => {
      el.gmResult.textContent = "Could not load the map";
    });
}

function updateGuessPhaseUi() {
  if (!el.gmTimer) return;
  if (!mp.active) {
    el.gmTimer.textContent = "";
    return;
  }
  if (mp.phase === "mark") {
    const sec = Math.max(0, Math.ceil(mp.markLeft));
    el.gmTimer.textContent = `${sec}s to mark`;
    if (el.gmTitle) el.gmTitle.textContent = "Where are you?";
  } else if (mp.phase === "results") {
    const sec = Math.max(0, Math.ceil(mp.resultsLeft));
    el.gmTimer.textContent =
      sec > 0 ? `Next round in ${sec}s` : "Starting next round…";
    if (el.gmTitle) el.gmTitle.textContent = "Results";
    el.gmSub.textContent = "Scores are in — next location coming up";
  } else {
    el.gmTimer.textContent = "";
  }
}

function maybeRevealGuesses() {
  const need = inRoundPlayers().length;
  if (!need || mp.guesses.size < need) {
    if (guessOpen) {
      el.gmResult.textContent = `Waiting for guesses… ${mp.guesses.size}/${need}`;
    }
    return;
  }
  revealMpGuesses();
}

function revealMpGuesses(force = false) {
  if (!mp.truth || guessAnswered) return;
  if (!force && mp.guesses.size < inRoundPlayers().length) return;
  guessAnswered = true;
  mp.phase = "results";
  mp.resultsLeft = RESULTS_TIME;
  const marks = [
    {
      lat: mp.truth.lat,
      lon: mp.truth.lon,
      color: "#d8a24a",
      label: "You were here",
      truth: true,
    },
  ];
  const results = [];
  for (const [id, g] of mp.guesses) {
    const err = distanceM(g.lat, g.lon, mp.truth.lat, mp.truth.lon) / 1000;
    results.push({ id, err, name: playerName(id) });
    marks.push({
      lat: g.lat,
      lon: g.lon,
      color: playerColor(id),
      label: playerName(id),
    });
  }
  for (const p of inRoundPlayers()) {
    if (!mp.guesses.has(p.id))
      results.push({ id: p.id, err: Infinity, name: playerName(p.id) });
  }
  drawGuessMap(marks);
  results.sort((a, b) => a.err - b.err);
  const marked = results.filter((r) => Number.isFinite(r.err));
  const best = marked[0]?.err ?? 0;
  const winners = marked.filter((r) => r.err - best < 0.5);
  if (winners.length === 1) {
    const w = winners[0];
    if (w.id === mp.myId) mp.myScore += 1;
    else if (mp.players.has(w.id)) mp.players.get(w.id).score += 1;
  }
  const line = results
    .map(
      (r) =>
        `${r.name} ${
          Number.isFinite(r.err) ? `${Math.round(r.err)} km` : "no mark"
        }`
    )
    .join(" · ");
  el.gmResult.textContent = !winners.length
    ? `No marks – ${line}`
    : winners.length > 1
    ? `Tie – ${line}`
    : winners[0]?.id === mp.myId
    ? `You win – ${line}`
    : `${winners[0]?.name} wins – ${line}`;
  updateGuessScores();
  el.gmClose.style.display = "none";
  el.gmRetry.style.display = "none";
  updateGuessPhaseUi();
  if (mp.host) broadcastRoster();
}

function updateGuessScores() {
  renderGuessStats();
  if (!el.gmScoreLeft || !el.gmScoreRight) return;
  if (!mp.active) {
    el.gmScoreLeft.textContent = "";
    el.gmScoreRight.textContent = "";
    return;
  }
  el.gmScoreLeft.textContent = `You ${mp.myScore}`;
  el.gmScoreRight.textContent = otherPlayers()
    .map((p) => `${p.name} ${p.score ?? 0}`)
    .join("  ");
}

el.gmCanvas.addEventListener("click", (e) => {
  if (guessAnswered) return;
  const rect = el.gmCanvas.getBoundingClientRect();
  const { lon, lat } = GUESS_SCOPES[guessScope].unproject(
    e.clientX - rect.left,
    e.clientY - rect.top,
    rect.width,
    rect.height
  );
  if (mp.active) {
    if (mp.guesses.has(mp.myId)) return;
    mp.guesses.set(mp.myId, { lat, lon });
    mp.net?.send({ t: "guess", lat, lon, from: mp.myId });
    const marks = [...mp.guesses].map(([id, g]) => ({
      lat: g.lat,
      lon: g.lon,
      color: playerColor(id),
      label: playerName(id),
    }));
    drawGuessMap(marks);
    maybeRevealGuesses();
    return;
  }
  const errKm = distanceM(lat, lon, plane.latDeg, plane.lonDeg) / 1000;
  guessAnswered = true;
  recordSoloGuess(errKm);
  drawGuessMap([
    {
      lat: plane.latDeg,
      lon: plane.lonDeg,
      color: "#d8a24a",
      label: "You were here",
      truth: true,
    },
    { lat, lon, color: "#f3ead6", label: "Your guess" },
  ]);
  el.gmResult.textContent = `Off by ${Math.round(errKm)} km`;
  el.gmClose.style.display = "";
  el.gmRetry.style.display = "";
});

el.gmClose.addEventListener("click", () => {
  el.guessmap.classList.remove("show");
  if (mp.active) backToLobby();
  else backToMenu();
});

el.bannerRetry.addEventListener("click", () => {
  if (mp.active) {
    hideBanner();
    backToLobby();
  } else restartMode();
});
el.bannerMenu.addEventListener("click", () => {
  hideBanner();
  if (mp.active) backToLobby();
  else backToMenu();
});

el.gmRetry.addEventListener("click", () => {
  if (mp.active) {
    requestRematch();
    return;
  }
  el.gmResult.textContent = "Picking a new point…";
  el.gmRetry.style.display = "none";
  el.gmClose.style.display = "none";
  restartMode();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && mp.active && !menuOpen) {
    e.preventDefault();
    if (!e.repeat) setTabList(true);
    return;
  }
  if (e.key === "Escape") {
    if (menuOpen) return;
    if (spaceScene?.overview) { toggleSpaceMap(false); return; }
    if (freeMap.open) {
      freeMap.hide();
      updateLocationMaps();
      return;
    }
    if (mp.active) {
      setLeaveOpen(!leaveOpen);
      return;
    }
    if (!guessOpen) setPaused(!paused);
    return;
  }
  if (e.target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === "t" && voiceEnabled()) {
    if (!e.repeat) startTalk();
    return;
  }
  if (k === "m" && !e.repeat && !menuOpen && !guessOpen && !paused) {
    e.preventDefault();
    if (mode === "free") toggleFreeMap();
    else showMapUnavailable();
    return;
  }
  if (!e.repeat && !menuOpen && !paused && !guessOpen && !leaveOpen &&
      !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (k === "." || e.code === "Period") {
      e.preventDefault();
      setThrottleLever(1);
      return;
    }
    if (k === "," || e.code === "Comma") {
      e.preventDefault();
      setThrottleLever(0);
      return;
    }
    if (k === "c") {
      e.preventDefault();
      flightCamera.cycle(camera);
      return;
    }
    if (k === "g" && !crashed && !finished) {
      e.preventDefault(); planeMesh?.userData.landingGear?.toggle(landingSystem.grounded); return;
    }
    if (k === "h" && plane?.isSailplane && !crashed && !finished) {
      e.preventDefault(); callSailplaneTow(); return;
    }
    if (k === "l" && plane?.isSailplane && !crashed && !finished) {
      e.preventDefault(); sailplaneTow.release(plane, landingSystem); return;
    }
    if (k === "enter" && selectedPlane === "falcon9" && !crashed && !finished && !freeMap.open && !pendingSnap && !awaitingSnap) {
      e.preventDefault();
      falconStageInput.press(performance.now());
      return;
    }
    if (k === "enter" && selectedPlane === "jet") {
      e.preventDefault();
      fireFighterMissile();
      return;
    }
    if (k === "enter" && selectedPlane === "drone") {
      e.preventDefault();
      fireDroneCannons();
      return;
    }
  }
  if (menuOpen || paused || guessOpen) return;
  keys.add(k);
  if (k === "shift" || k === "control") syncThrottleUi();
  if (k === "r" && (crashed || finished)) restartMode();
});
window.addEventListener("keyup", (e) => {
  if (e.key === "Tab") setTabList(false);
  if (e.target && e.target.tagName === "INPUT") return;
  const k = e.key.toLowerCase();
  if (k === "t") stopTalk();
  keys.delete(k);
  if (k === "shift" || k === "control") syncThrottleUi();
});
el.mpOnline?.addEventListener("click", () => {
  if (!mp.active || menuOpen) return;
  setTabList(!tabListOpen);
});
window.addEventListener("blur", () => stopTalk());
window.addEventListener("blur", () => { landingBrake = false; keys.delete("b"); });
document.getElementById("gear-toggle")?.addEventListener("click", () => { if (!paused && !crashed) planeMesh?.userData.landingGear?.toggle(landingSystem.grounded); });
function callSailplaneTow() {
  if (!plane?.isSailplane || menuOpen || paused || guessOpen || leaveOpen || crashed || finished || freeMap.open) return;
  if (sailplaneTow.call(plane, landingSystem, () => checkTowPath(plane, landingSystem.runway, grassFields, probeColumn))) {
    setThrottleLever(0); landingBrake = false;
  }
}
document.getElementById("tow-call")?.addEventListener("click", callSailplaneTow);
document.getElementById("tow-release")?.addEventListener("click", () => {
  if (!menuOpen && !paused && !guessOpen && !leaveOpen && !crashed && !finished) sailplaneTow.release(plane, landingSystem);
});
const brakeButton = document.getElementById("wheel-brake");
brakeButton?.addEventListener("pointerdown", e => { if (paused || crashed) return; landingBrake = true; brakeButton.setPointerCapture(e.pointerId); });
for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) brakeButton?.addEventListener(event, () => { landingBrake = false; });

function deployBooster() {
  if (selectedPlane !== "falcon9" || menuOpen || paused || guessOpen || leaveOpen || crashed || finished ||
      freeMap.open || pendingSnap || awaitingSnap || !plane.isLunar || plane.height > 150000) return;
  const normal = WGS84_ELLIPSOID.getCartographicToNormal(plane.lat, plane.lon, new Vector3()).transformDirection(tiles.group.matrixWorld);
  const basis = frameAt(plane.lat, plane.lon, plane.height, 0, 0, 0);
  const velocity = new Vector3(plane.velocity.x, plane.velocity.z, -plane.velocity.y).applyQuaternion(new Quaternion().setFromRotationMatrix(basis));
  const ground = probeSurface(plane.lat, plane.lon, Math.max(2500, plane.height)) ?? groundAlt;
  if (plane.height - ground < 60) return;
  const target = earthPosition(plane.lat, plane.lon, ground, tiles.group.matrixWorld, new Vector3());
  if (!releaseBooster(planeMesh, scene, velocity, normal, { target, shadows: vehicleGroundShadows })) return;
  // Recenter the controlled upper stage without moving any visible geometry
  // or resetting its inherited velocity and inertial attitude.
  const ecef = planeMesh.position.clone().applyMatrix4(tiles.group.matrixWorld.clone().invert()), pose = {};
  WGS84_ELLIPSOID.getPositionToCartographic(ecef, pose);
  plane.lat = pose.lat; plane.lon = pose.lon; plane.height = pose.height;
  plane.rebaseFromGeodetic({ preserveVelocity: true });
  plane.surfaceClearance = plane.collisionRadius = falconState(planeMesh).upperClearance;
  flightCamera.setModel(falconState(planeMesh).parent, { vertical: true });
  camInit = false;
}
document.getElementById("booster-release")?.addEventListener("click", () => { falconStageInput.reset(); deployBooster(); });

function deployDragon() {
  if (selectedPlane !== "falcon9" || menuOpen || paused || guessOpen || leaveOpen || crashed || finished || freeMap.open || pendingSnap || awaitingSnap) return;
  if (plane.isLunar && plane.height > 80000) return;
  // Controller stores east/north/up; the level flight frame is east/up/south.
  const v = plane.velocity;
  if (!v) return;
  const velocity = new Vector3(v.x, v.z, -v.y).applyQuaternion(skyQuat);
  const up = new Vector3(0, 1, 0).applyQuaternion(skyQuat);
  releaseDragon(planeMesh, scene, velocity, up, vehicleGroundShadows);
}
el.dragonRelease?.addEventListener("click", () => { falconStageInput.reset(); deployDragon(); });

function toggleSpaceMap(enabled = !spaceScene?.overview) {
  if (!spaceScene) return;
  spaceScene.setOverview(enabled);
  document.getElementById("space-map-toggle").setAttribute("aria-pressed", String(enabled));
  document.getElementById("space-map-toggle").textContent = enabled ? "Return to flight" : "Space map";
  document.getElementById("space-map-help").hidden = !enabled;
  keys.clear();
}
document.getElementById("space-map-toggle").addEventListener("click", () => toggleSpaceMap());
document.getElementById("moon-guidance").addEventListener("click", () => {
  if (!plane?.isLunar || menuOpen || paused || crashed || pendingSnap || awaitingSnap) return;
  if (plane.guidanceActive) {
    plane.stopLunarGuidance();
    setThrottleLever(plane.throttle);
  } else plane.startLunarGuidance();
});
document.getElementById("space-warp").addEventListener("change", e => plane?.isLunar && plane.setTimeWarp(e.target.value));
document.getElementById("magnetosphere-toggle").addEventListener("change", e => {
  if (e.target.checked) toggleSpaceMap(true);
  magnetosphere?.setVisible(e.target.checked);
});
document.getElementById("solar-pressure").addEventListener("change", e => { solarPressure = Number(e.target.value); });

function updateSpaceHud() {
  const panel = document.getElementById("space-panel");
  panel.hidden = menuOpen || paused || guessOpen || leaveOpen || freeMap.open || (!plane.isLunar && plane.height < 20000);
  if (panel.hidden) return;
  const d = plane.isLunar ? plane.diagnostics() : null;
  const stage = { manual: "Manual flight", ascent: "Earth ascent", dogleg: "Clearing Earth", transfer: "Lunar transfer", "lunar-descent": "Lunar descent", arrived: "LANDED ON THE MOON", impact: "Impact" };
  const distance = metres => metres < 1000 ? `${Math.max(0, metres).toFixed(1)} m` : `${(metres / 1000).toLocaleString("en", { maximumFractionDigits: 1 })} km`;
  const seconds = Math.floor(spaceTime);
  document.getElementById("space-status").textContent = d ? stage[d.guidancePhase] : "Near space";
  document.getElementById("space-details").textContent = d
    ? `Moon surface: ${distance(d.remainingDistanceM)}\nMoon-relative speed: ${d.relativeMoonSpeedMps.toFixed(1)} m/s\nEarth altitude: ${distance(d.earthAltitudeM)}\nElapsed: ${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s · ${d.effectiveTimeWarp}×${d.effectiveTimeWarp < d.timeWarp ? " (limited near surface)" : ""}${d.touchdownSpeedMps !== null ? `\nTouchdown: ${d.touchdownSpeedMps.toFixed(2)} m/s` : ""}`
    : `Earth altitude: ${distance(plane.height)}\nMoon: ${distance(spaceObserver.distanceTo(spaceMoon) - SPACE_CONSTANTS.MOON_RADIUS)}`;
  const guidance = document.getElementById("moon-guidance");
  guidance.hidden = !d;
  guidance.disabled = crashed || pendingSnap || awaitingSnap || (d && d.status !== "flight");
  guidance.textContent = d?.guidanceActive ? "Stop guidance" : d?.status === "landed-moon" ? "Moon reached" : "Fly to Moon";
  const warp = document.getElementById("space-warp");
  warp.closest("label").hidden = !d;
  warp.disabled = crashed;
  if (d) warp.value = String(d.timeWarp);
  const environment = classifySpaceEnvironment(spaceObserver.clone().applyAxisAngle(new Vector3(0, 0, 1), solar.siderealAngle), {
    sunDirection: spaceSun, siderealTime: solar.siderealAngle, solarPressure,
  });
  document.getElementById("space-environment").textContent = `${environment.label}${environment.zoneLabels.length ? " · " + environment.zoneLabels.join(" · ") : ""}\nFrom Earth centre: ${(environment.centerMeters / SPACE_CONSTANTS.EARTH_MEAN_RADIUS).toFixed(2)} Rₑ · altitude: ${distance(environment.altitudeMeters)}`;
}

function fireFighterMissile() {
  if (selectedPlane !== "jet" || menuOpen || paused || guessOpen || leaveOpen || crashed || finished ||
      pendingSnap || awaitingSnap || freeMap.open) return;
  const up = new Vector3().setFromMatrixColumn(frameAt(plane.lat, plane.lon, plane.height, 0, 0, 0), 1).normalize();
  const shot = fighterMissiles?.fire(planeMesh, { speed: plane.speed, up });
  if (shot && mp.active) mp.net?.send({
    t: "missile", from: mp.myId, seq: ++missileShotSeq, station: shot.station,
    lat: plane.latDeg, lon: plane.lonDeg, h: plane.height,
    heading: plane.heading, pitch: plane.pitch, roll: plane.roll, kmh: plane.kmh,
  });
}
el.missileFire?.addEventListener("click", fireFighterMissile);

function fireDroneCannons() {
  if (selectedPlane !== "drone" || menuOpen || paused || guessOpen || leaveOpen || crashed || finished ||
      pendingSnap || awaitingSnap || freeMap.open) return;
  const up = new Vector3().setFromMatrixColumn(frameAt(plane.lat, plane.lon, plane.height, 0, 0, 0), 1).normalize();
  if (droneCannons?.fire(planeMesh, { speed: plane.speed, up }) && mp.active) {
    mp.net?.send({ t: "drone-burst", from: mp.myId, seq: ++droneBurstSeq });
  }
}
el.droneFire?.addEventListener("click", fireDroneCannons);

function receiveDroneBurst(data) {
  if (!mp.active || menuOpen || guessOpen || !data.from || data.from === mp.myId) return;
  const mate = mp.mates.get(data.from);
  if (mate?.key !== "drone" || !mate.mesh || !Number.isSafeInteger(data.seq) ||
      data.seq <= (lastDroneBurstSeq.get(data.from) ?? 0)) return;
  lastDroneBurstSeq.set(data.from, data.seq);
  // The burst follows the interpolated peer model; one event drives all 96 rounds.
  droneCannons?.fire(mate.mesh, { speed: (mate.kmh ?? 0) / 3.6, up: mate.mesh.position.clone().normalize() });
}

function receiveFighterMissile(data) {
  if (!mp.active || menuOpen || guessOpen || !data.from || data.from === mp.myId) return;
  const mate = mp.mates.get(data.from);
  if (mate?.key !== "jet" || !mate.mesh || !Number.isSafeInteger(data.seq) ||
      data.seq <= (lastMissileShotSeq.get(data.from) ?? 0) ||
      !Number.isInteger(data.station) || data.station < 0 || data.station > 3 ||
      ![data.lat, data.lon, data.h, data.heading, data.pitch, data.roll, data.kmh].every(Number.isFinite) ||
      Math.abs(data.lat) > 90 || Math.abs(data.lon) > 180 || data.kmh < 0 || data.kmh > 2500) return;
  lastMissileShotSeq.set(data.from, data.seq);
  const lat = data.lat * Math.PI / 180, lon = data.lon * Math.PI / 180;
  const poseMatrix = frameAt(lat, lon, data.h, data.heading, data.pitch, -data.roll);
  const up = new Vector3().setFromMatrixColumn(frameAt(lat, lon, data.h, 0, 0, 0), 1).normalize();
  fighterMissiles?.fire(mate.mesh, { speed: data.kmh / 3.6, up, station: data.station, poseMatrix });
}

const touch = {
  roll: 0,
  pitch: 0,
  boost: false,
  brake: false,
  pid: null,
  thr: null,
};

function setThrottleLever(v) {
  throttleLever = Math.max(0, Math.min(1, v));
  if (!keys.has("shift") && !keys.has("control")) throttleShown = throttleLever;
  syncThrottleUi();
}

function throttleTarget() {
  if (sailplaneTow.attached) return 0;
  if (plane?.isSailplane) {
    if (keys.has("control")) return 1;
    if (keys.has("shift")) return 0;
    return throttleLever;
  }
  if (keys.has("shift")) return 1;
  if (keys.has("control")) return 0;
  return throttleLever;
}

function tickThrottle(dt) {
  const target = throttleTarget();
  const step = THROTTLE_RATE * dt;
  if (throttleShown < target)
    throttleShown = Math.min(target, throttleShown + step);
  else if (throttleShown > target)
    throttleShown = Math.max(target, throttleShown - step);
  syncThrottleUi();
}

function syncThrottleUi() {
  const gliding = !!plane?.isSailplane;
  const label = el.throttle?.querySelector("span");
  if (label) label.textContent = gliding ? "AIRBRK" : plane?.isBalloon ? "HEAT" : "THR";
  el.throttleRail?.setAttribute("aria-label", gliding ? "Airbrakes" : plane?.isBalloon ? "Balloon burner heat" : "Throttle");
  if (el.throttleKnob) {
    el.throttleKnob.style.bottom = `${throttleShown * 100}%`;
  }
  el.throttleRail?.setAttribute(
    "aria-valuenow",
    String(Math.round(throttleShown * 100))
  );
}

function syncThrottleVis() {
  const show =
    !menuOpen && !paused && !leaveOpen && !guessOpen && !crashed && !finished;
  el.throttle?.classList.toggle("hidden", !show);
}

function throttleFromClientY(clientY) {
  if (!el.throttleRail) return throttleLever;
  const r = el.throttleRail.getBoundingClientRect();
  if (r.height < 1) return throttleLever;
  return (r.bottom - clientY) / r.height;
}

function resetStick() {
  touch.roll = 0;
  touch.pitch = 0;
  touch.pid = null;
  if (el.stickKnob) el.stickKnob.style.transform = "";
}

function moveStick(clientX, clientY) {
  if (!el.stick) return;
  const r = el.stick.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let dx = clientX - cx;
  let dy = clientY - cy;
  const max = r.width * 0.42;
  const mag = Math.hypot(dx, dy);
  if (mag > max) {
    dx = (dx / mag) * max;
    dy = (dy / mag) * max;
  }
  const nx = dx / max;
  const ny = dy / max;
  const dead = 0.12;
  touch.roll = Math.abs(nx) < dead ? 0 : nx;
  touch.pitch = Math.abs(ny) < dead ? 0 : ny;
  if (el.stickKnob)
    el.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
}

function bindHold(btn, down, up) {
  if (!btn) return;
  const start = (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    btn.classList.add("held");
    down();
  };
  const end = (e) => {
    e.preventDefault();
    btn.classList.remove("held");
    up();
  };
  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", end);
  btn.addEventListener("pointercancel", end);
}

if (el.stick) {
  el.stick.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    touch.pid = e.pointerId;
    el.stick.setPointerCapture(e.pointerId);
    moveStick(e.clientX, e.clientY);
  });
  el.stick.addEventListener("pointermove", (e) => {
    if (touch.pid !== e.pointerId) return;
    moveStick(e.clientX, e.clientY);
  });
  const endStick = (e) => {
    if (touch.pid != null && e.pointerId !== touch.pid) return;
    resetStick();
  };
  el.stick.addEventListener("pointerup", endStick);
  el.stick.addEventListener("pointercancel", endStick);
}
bindHold(
  el.touchTalk,
  () => startTalk(),
  () => stopTalk()
);
el.touchPause?.addEventListener("click", () => setPaused(true));
el.touchMap?.addEventListener("click", () => toggleFreeMap());
el.stick?.addEventListener("touchmove", (e) => e.preventDefault(), {
  passive: false,
});

if (el.throttleRail) {
  const startThr = (e) => {
    e.preventDefault();
    touch.thr = e.pointerId;
    el.throttleRail.setPointerCapture(e.pointerId);
    setThrottleLever(throttleFromClientY(e.clientY));
  };
  const moveThr = (e) => {
    if (touch.thr !== e.pointerId) return;
    setThrottleLever(throttleFromClientY(e.clientY));
  };
  const endThr = (e) => {
    if (touch.thr != null && e.pointerId !== touch.thr) return;
    touch.thr = null;
  };
  el.throttleRail.addEventListener("pointerdown", startThr);
  el.throttleRail.addEventListener("pointermove", moveThr);
  el.throttleRail.addEventListener("pointerup", endThr);
  el.throttleRail.addEventListener("pointercancel", endThr);
}

window.addEventListener("wheel", (e) => {
  if (menuOpen || paused || leaveOpen || guessOpen || crashed || finished || freeMap.open || spaceScene?.overview) return;
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || !Number.isFinite(e.deltaY) || e.deltaY === 0) return;
  if (e.target?.isContentEditable || e.target?.closest?.("input, textarea, select, #traffic-panel, #landing-panel, #space-panel")) return;
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  const delta = e.deltaY * unit;
  setThrottleLever(throttleLever - Math.sign(delta) * Math.min(0.12, Math.abs(delta) * 0.0006));
}, { passive: false });

function syncTouchUi() {
  if (!el.touch) return;
  const show =
    !menuOpen && !paused && !leaveOpen && !guessOpen && !crashed && !finished;
  el.touch.classList.toggle("hidden", !show);
  el.touch.classList.toggle("show", show);
  el.touch.classList.toggle("talk", voiceEnabled());
  el.touch.classList.toggle("free", mode === "free");
  syncThrottleVis();
  if (!show) resetStick();
}

async function restartMode() {
  if (mp.active) {
    backToLobby();
    return;
  }
  if (mode === "home" && homeTarget) {
    beginFlight(startLat, startLon);
    placeBeaconAt(homeTarget.lat, homeTarget.lon);
  } else if (mode === "guess") {
    const p = await pickGuessStart(guessScope);
    beginFlight(p.lat, p.lon);
  } else {
    beginFlight(startLat, startLon);
  }
}

const flightCamera = new FlightCamera();
const camPos = flightCamera.position;
const camTarget = flightCamera.target;
const planePos = new Vector3();
const planeQuat = new Quaternion();
const offset = new Vector3();
const camFramePos = new Vector3();
const camFrameQuat = new Quaternion();
const camFrameScale = new Vector3();
if (import.meta.env.DEV) {
  window.__beginFlight = (lat, lon) => {
    mode = "guess";
    guessScope = "world";
    paused = false;
    crashed = false;
    finished = false;
    menuOpen = false;
    el.menu?.classList.add("hidden");
    el.landing?.classList.add("hidden");
    el.lobby?.classList.add("hidden");
    beginFlight(lat, lon);
  };
}
window.__foeDebug = () => ({
  state: "dbg",
  lat: plane?.latDeg,
  lon: plane?.lonDeg,
  h: plane?.height,
  gh: groundAlt,
  surf: lastSurf,
  agl: plane ? plane.height - groundAlt : null,
  pendingSnap,
  awaitingSnap,
  snapBestGh,
  speed: plane?.speed,
  menuOpen,
  guessOpen,
  paused,
  crashed,
  finished,
  tilesLoaded: tiles?.stats?.loaded || 0,
  tilesLoading: tiles?.stats?.loading || 0,
  tilesQueue: tiles?.stats?.inQueue || 0,
  tilesFailed: tiles?.stats?.failed || 0,
  tilesParsed: tiles?.stats?.parsed || 0,
  tileKey: tilePool?.current?.kind || "none",
  tileSlot: tilePool?.current?.slot || -1,
  tileMaxed: tile429Count,
  camPos: camera?.position?.toArray?.() || [],
  cameraMode: FLIGHT_CAMERAS[flightCamera.mode].name,
  traffic: liveTraffic?.debug(),
  spaceSky: sky?.uniforms.uSpace.value,
  daylight: localSun ? { ...localSun, utc: new Date(solar.utcMs).toISOString(), siderealAngle: solar.siderealAngle } : null,
  flightClock: flightClock.diagnostics(),
  balloon: plane?.isBalloon ? { heat: plane.heat, burner: plane.throttle, climbMps: plane.verticalSpeed, northMps: plane.northSpeed, eastMps: plane.eastSpeed } : null,
  landing: plane ? landingSystem.diagnostics(plane) : null,
  sailplane: plane?.isSailplane ? { grassMap: grassFields.status, grass: !!landingSystem.runway.isGrass, towPhase: sailplaneTow.phase, tow: sailplaneTow.snapshot(), reason: sailplaneTow.reason } : null,
  space: plane?.isLunar ? plane.diagnostics() : null,
  spaceMap: spaceScene?.overview,
  moonRenderPosition: spaceScene?.moonWorld.toArray(),
  magnetosphere: magnetosphere?.diagnostics(),
});
const skyQuat = new Quaternion(); // lokalna ramka N/S (bez kursu) — dla kopuły nieba i słońca
const skyFramePos = new Vector3();
const skyFrameScale = new Vector3();
let camInit = false;

void init();
animate();

window.addEventListener("error", (e) => {
  const msg = e.message || "Unexpected error";
  if (!msg || msg === "Script error.") return;
  rememberError(msg);
  if (awaitingSnap || !menuOpen) showFatal(msg);
  else if (el.menuError) el.menuError.textContent = msg;
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = String(e.reason?.message || e.reason || "Unexpected error");
  rememberError(msg);
  if (awaitingSnap || !menuOpen) showFatal(msg);
  else if (el.menuError) el.menuError.textContent = msg;
});
window.addEventListener("pagehide", () => {
  if (isMobile && awaitingSnap) markStarting();
});

function animate() {
  requestAnimationFrame(animate);
  try {
    tickFrame();
  } catch (err) {
    console.error(err);
    showFatal(err?.message || "The game crashed while drawing a frame");
  }
}

function tickFrame() {
  if (!tiles || !plane) return;

  const dt = Math.min(clock.getDelta(), 0.05);
  frameCount += 1;
  scene.updateMatrixWorld();

  let flying = !menuOpen && !paused && !guessOpen && !crashed && !finished;
  if (flying && !leaveOpen && !freeMap.open && !pendingSnap && !awaitingSnap) falconStageInput.update(performance.now());
  else falconStageInput.reset();

  // sterowanie lotnicze: W / góra = drążek od siebie = nos w dół
  const keyRoll =
    (keys.has("d") || keys.has("arrowright") ? 1 : 0) -
    (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
  const keyPitch =
    (keys.has("s") || keys.has("arrowdown") ? 1 : 0) -
    (keys.has("w") || keys.has("arrowup") ? 1 : 0);
  const rollIn = spaceScene.overview ? 0 : keyRoll || touch.roll;
  const pitchIn = spaceScene.overview ? 0 : keyPitch || touch.pitch;
  const controlBlend = 1 - Math.exp(-6 * dt);
  ctrl.roll += (rollIn - ctrl.roll) * controlBlend;
  ctrl.pitch += (pitchIn - ctrl.pitch) * controlBlend;
  if (flying && plane.isLunar && (plane.guidanceActive || plane.spaceStatus === "landed-moon")) {
    throttleShown = plane.throttle;
    syncThrottleUi();
  } else if (flying) tickThrottle(dt);
  else if (throttleShown !== throttleLever) {
    throttleShown = throttleLever;
    syncThrottleUi();
  }
  ctrl.throttle = plane.isSailplane ? 0 : throttleShown;
  ctrl.airbrake = plane.isSailplane ? throttleShown : 0;
  landingSystem.gear = planeMesh?.userData.landingGear || null;
  if (flying && landingSystem.gear) {
    if (plane.isSailplane && frameCount % 120 === 0 && plane.height - groundAlt < 700) void grassFields.update(plane);
    const onGrass = grassLanding.update(plane, landingSystem, probeColumn, dt);
    if (!onGrass && !(landingSystem.runway.isGrass && sailplaneTow.attached)) {
      const nextRunway = airportRunways.choose(plane, { current: landingSystem.runway.isGrass ? null : landingSystem.runway, locked: landingSystem.grounded || landingSystem.bounceTime > 0, preferred: mode === "landing" ? selectedApproach : null });
      if (nextRunway !== landingSystem.runway) { landingSystem.reset(); landingSystem.runway = nextRunway; }
    }
  }
  const activeRunway = landingSystem.runway;
  const nearRunway = landingSystem.gear && landingSystem.near(plane);
  // Free-flight arrivals share the same runway and ground physics as practice.
  // Finish terrain calibration while safely airborne, never move the pavement under the wheels.
  if (flying && !pendingSnap && !awaitingSnap && nearRunway && frameCount % 60 === 0) {
    const p = activeRunway.coordinates(plane);
    const distance = Math.hypot(p.x, Math.max(0, p.z, -p.z - activeRunway.definition.length));
    if (p.y > 60 && (!activeRunway.calibrated || distance < activeRunway.physical.calibrationDistance * .6)) {
      activeRunway.calibrate(probeSurface, { force: true, distance });
    }
  }
  ctrl.approach = !!(landingSystem.gear && (mode === "landing" || (nearRunway && landingSystem.gear.target === 1 && plane.height < activeRunway.elevation + 1000)));
  ctrl.approachSpeed = landingSystem.gear?.speed || 0;
  ctrl.wheelBrake = keys.has("b") || landingBrake;
  landingSystem.gear?.update(flying ? dt : 0, plane.speed, landingSystem.grounded, landingSystem.touchdown?.sink || 0);

  if (flying) {
    if (sailplaneTow.attached && landingSystem.grounded && ctrl.wheelBrake) sailplaneTow.release(plane, landingSystem);
    sailplaneTow.update(dt, plane, landingSystem);
    updateFlightPhysics(dt);
    flying = !crashed;
  }
  if (plane.isLunar) spaceTime = plane.simulationTime;
  else if (flying) spaceTime += dt;
  if ((!menuOpen || awaitingSnap) && plane.height < 100000) airportRunways.updateVisuals(plane);
  const landingPanel = document.getElementById("landing-panel");
  if (landingPanel) {
    landingPanel.hidden = menuOpen || paused || guessOpen || leaveOpen || freeMap.open || !landingSystem.gear || (!plane.isSailplane && !nearRunway && mode !== "landing");
    if (!landingPanel.hidden && frameCount % 8 === 0) {
      const d = landingSystem.diagnostics(plane);
      const status = d.reason || (d.status === "stopped" ? "LANDED · aircraft stopped on its wheels" : d.status === "rollout" ? `ON WHEELS · hold B to brake · ${Math.round(d.runwayRemainingM)} m left` : d.status === "bounced" ? "BOUNCE · stabilize and flare gently" : `${d.airportId} RWY ${d.ident} · ${Math.max(0,d.distanceToThresholdM/1000).toFixed(1)} km to threshold`);
      document.getElementById("landing-status").textContent = status;
      document.getElementById("landing-details").textContent = `${Math.round(d.speedKmh)} / target ${Math.round(d.targetKmh)} km/h · sink ${d.sinkMps.toFixed(1)} m/s\nCentreline ${Math.round(d.crossTrackM)} m · glide ${d.glideErrorM > 0 ? "+" : ""}${Math.round(d.glideErrorM)} m\nWheels above runway ${Math.max(0,d.wheelClearanceM).toFixed(1)} m`;
      const gearButton = document.getElementById("gear-toggle");
      gearButton.textContent = landingSystem.gear.fixed ? "Fixed landing gear" : `G · Gear ${d.gearDown ? "DOWN" : d.gearExtension < .02 ? "UP" : "moving…"}`;
      gearButton.disabled = landingSystem.grounded || landingSystem.gear.fixed || crashed;
      brakeButton.textContent = ctrl.wheelBrake ? "BRAKING" : "Hold B · Wheel brakes";
      document.getElementById("sailplane-actions").hidden = !plane.isSailplane;
      if (plane.isSailplane) {
        if (activeRunway.isGrass) {
          document.getElementById("landing-status").textContent = d.grounded ? (d.status === "stopped" ? "ON GRASS · ready for tow" : "ON GRASS · hold B to stop") : "GRASS FIELD · keep wings level and flare gently";
          document.getElementById("landing-details").textContent = `${Math.round(plane.kmh)} km/h · sink ${d.sinkMps.toFixed(1)} m/s\nWheels above grass ${Math.max(0, d.wheelClearanceM).toFixed(1)} m`;
        }
        else if (!nearRunway) {
          document.getElementById("landing-status").textContent = "GLIDING · choose a flat grass field";
          document.getElementById("landing-details").textContent = `${Math.round(plane.kmh)} km/h · sink ${(-plane.verticalSpeed).toFixed(1)} m/s`;
        }
        document.getElementById("grass-field-status").textContent = grassFields.status === "loading" ? "Checking grass fields nearby…" : grassFields.status === "unavailable" ? "Grass map unavailable · retrying shortly. Airport landings still work." : "Grass landings: flat, open fields · B to stop · call Cessna to fly again";
        document.getElementById("tow-status").textContent = sailplaneTow.reason;
        document.getElementById("tow-call").disabled = !landingSystem.grounded || plane.speed >= .5 || sailplaneTow.busy || crashed;
        document.getElementById("tow-release").hidden = !sailplaneTow.busy;
        document.getElementById("tow-release").textContent = sailplaneTow.attached ? "L · Release tow rope" : "L · Cancel tow";
        if (sailplaneTow.attached) {
          document.getElementById("landing-status").textContent = d.grounded ? "AEROTOW · accelerating behind Cessna" : "AEROTOW · climbing behind Cessna";
          document.getElementById("landing-details").textContent = `${Math.round(plane.kmh)} km/h · climb ${Math.max(0, plane.verticalSpeed).toFixed(1)} m/s\n${Math.max(0, Math.round(plane.height - sailplaneTow.groundHeight))} m above departure field · auto release at 350 m`;
        }
      }
    }
  }

  // dźwięk silnika — obroty z przepustnicy i prędkości, opływ z prędkości
  const speed01 = plane.speed / plane.boost;
  const rpm01 = plane.isBalloon ? plane.throttle : Math.min(1, Math.max(0.15, 0.22 + plane.throttle * 0.78));
  updateEngineSound(flying, sailplaneTow.busy ? .75 : rpm01, speed01, sailplaneTow.busy ? "plane" : PLANES[selectedPlane].sound);
  if (plane.isSailplane) updateSailplane(planeMesh, plane.airbrake);
  updateMusic();

  // pozycja i orientacja samolotu
  const m = frameAt(
    plane.lat,
    plane.lon,
    plane.height,
    plane.heading,
    plane.pitch,
    -plane.roll
  );
  m.decompose(planePos, planeQuat, planeMesh.scale);
  if (plane.isLunar) planeQuat.copy(plane.orientationECEF).premultiply(new Quaternion().setFromRotationMatrix(tiles.group.matrixWorld));
  planeMesh.position.copy(planePos);
  planeMesh.quaternion.copy(planeQuat);
  sailplaneTow.render(scene, frameAt, planeMesh, flying ? dt : 0, !menuOpen && !guessOpen && !crashed);
  if (planeMesh.userData.prop) {
    planeMesh.userData.prop.rotation.z += plane.speed * dt * 1.6;
  }
  spinRotors(planeMesh, dt, plane.speed);
  updateCombatDrone(planeMesh, flying ? dt : 0, plane.throttle, flying);
  updateBalloon(planeMesh, flying ? dt : 0, plane.throttle);
  updateFighterSurfaces(planeMesh, paused ? 0 : dt, flying ? ctrl.roll : 0, flying ? ctrl.pitch : 0);
  const verticalRocket = PLANES[selectedPlane].vertical;
  updateRocketExhaust(planeMesh, dt, plane.isLunar ? plane.throttle * 15000 : plane.kmh, flying && (!plane.isLunar || plane.throttle > .02));
  updateDragon(planeMesh, dt, tiles.group, flying && plane.height < 80000, !menuOpen && !guessOpen && plane.height < 80000);
  updateBooster(planeMesh, dt, tiles.group, { active: !menuOpen && !paused && !guessOpen,
    visible: !menuOpen && !guessOpen, timeWarp: plane.effectiveTimeWarp ?? 1 });
  const boosterButton = document.getElementById("booster-release"), boosterStatus = document.getElementById("booster-status");
  const falcon = selectedPlane === "falcon9" ? falconState(planeMesh) : null;
  boosterButton.hidden = !verticalRocket || !flying || freeMap.open;
  boosterButton.disabled = !falcon || falcon.boosterReleased || pendingSnap || awaitingSnap || plane.height > 150000 || plane.height - groundAlt < 60;
  boosterButton.textContent = falcon?.boosterReleased ? "Booster separated" : "Enter ×2 · Separate booster";
  boosterStatus.hidden = !falcon?.recovery;
  if (falcon?.recovery) {
    const recovery = falcon.recovery;
    const labels = { separation: "SEPARATION", boostback: "BOOSTBACK BURN", entry: "RETURNING", "landing-burn": "LANDING BURN", landed: "BOOSTER LANDED", failed: "BOOSTER LOST" };
    boosterStatus.textContent = `${labels[recovery.phase]} · ${Math.max(0, recovery.height).toFixed(0)} m · legs ${Math.round(recovery.legs * 100)}%`;
  }
  if (el.dragonRelease) {
    el.dragonRelease.hidden = !verticalRocket || !flying || freeMap.open || plane.height > 80000;
    const released = !!falconState(planeMesh)?.released;
    el.dragonRelease.disabled = released || plane.height > 80000;
    el.dragonRelease.textContent = released ? "Dragon released" : plane.height > 80000 ? "Dragon parachute · below 80 km" : "Enter · Release Dragon";
  }
  if (el.missileFire) {
    const status = fighterMissiles?.status(planeMesh);
    el.missileFire.hidden = selectedPlane !== "jet" || !flying || leaveOpen || pendingSnap || awaitingSnap || freeMap.open;
    el.missileFire.disabled = !status?.canFire;
    el.missileFire.textContent = status?.available ? `Enter · Fire missile (${status.available}/${status.total})` : "Missiles reloading…";
  }
  if (el.droneFire) {
    const status = droneCannons?.status(planeMesh);
    el.droneFire.hidden = selectedPlane !== "drone" || !flying || leaveOpen || pendingSnap || awaitingSnap || freeMap.open;
    el.droneFire.disabled = !status?.canFire;
    el.droneFire.textContent = status?.firing ? "Firing burst…" : status?.canFire ? "Enter · Fire burst" : "Cannons readying…";
  }
  for (const mate of mp.mates.values()) {
    if (mate.mesh) spinRotors(mate.mesh, dt, plane.speed);
  }

  if (mp.active && !menuOpen && !guessOpen && !crashed) {
    const now = performance.now();
    if (now - mp.lastPoseAt > MATE_SEND_MS) {
      mp.lastPoseAt = now;
      mp.poseSeq += 1;
      mp.net?.send({
        t: "pose",
        from: mp.myId,
        seq: mp.poseSeq,
        at: now,
        lat: plane.latDeg,
        lon: plane.lonDeg,
        h: plane.height,
        heading: plane.heading,
        pitch: plane.pitch,
        roll: plane.roll,
        plane: selectedPlane,
        kmh: plane.kmh,
        controlRoll: ctrl.roll,
        controlPitch: ctrl.pitch,
        throttle: plane.throttle,
        airbrake: plane.airbrake ?? 0,
        tow: plane.isSailplane ? sailplaneTow.snapshot() : null,
        dragonReleased: !!falconState(planeMesh)?.released,
        booster: selectedPlane === "falcon9" ? boosterSnapshot(planeMesh, tiles.group.matrixWorld) : null,
      });
    }
  }
  if (mp.active && !menuOpen) {
    const deg = Math.PI / 180;
    const renderAt = performance.now() - MATE_INTERP_MS;
    for (const [id, track] of mp.poses) {
      if (id === mp.myId) continue;
      const samples = track.samples;
      if (!mp.mates.get(id)?.mesh) loadMate(id, track.plane || "pa28");
      const mate = mp.mates.get(id);
      if (!mate?.mesh || !samples?.length) continue;
      let from = samples[0];
      let to = samples[samples.length - 1];
      let u = 1;
      if (renderAt <= samples[0].at) {
        to = from;
        u = 0;
      } else if (renderAt >= to.at) {
        from = to;
        u = 1;
      } else {
        for (let i = 1; i < samples.length; i++) {
          if (samples[i].at >= renderAt) {
            from = samples[i - 1];
            to = samples[i];
            u = (renderAt - from.at) / Math.max(1, to.at - from.at);
            break;
          }
        }
      }
      const mm = frameAt(
        (from.lat + (to.lat - from.lat) * u) * deg,
        (from.lon + (to.lon - from.lon) * u) * deg,
        from.h + (to.h - from.h) * u,
        lerpAngle(from.heading, to.heading, u),
        from.pitch + (to.pitch - from.pitch) * u,
        -(from.roll + (to.roll - from.roll) * u)
      );
      mm.decompose(matePos, mateQuat, mateScale);
      mate.mesh.position.copy(matePos);
      mate.mesh.quaternion.copy(mateQuat);
      mate.mesh.scale.copy(mateScale);
      mate.mesh.visible = true;
      const mateRoll = (from.controlRoll ?? 0) + ((to.controlRoll ?? 0) - (from.controlRoll ?? 0)) * u;
      const matePitch = (from.controlPitch ?? 0) + ((to.controlPitch ?? 0) - (from.controlPitch ?? 0)) * u;
      updateFighterSurfaces(mate.mesh, paused ? 0 : dt, mateRoll, matePitch);
      const kmh = (from.kmh ?? 0) + ((to.kmh ?? 0) - (from.kmh ?? 0)) * u;
      updateCombatDrone(mate.mesh, paused ? 0 : dt, kmh / (PLANES[mate.key].boost * 3.6), true);
      updateBalloon(mate.mesh, paused ? 0 : dt, to.throttle ?? .5);
      if (mate.key === "sailplane") updateSailplane(mate.mesh, (from.airbrake ?? 0) + ((to.airbrake ?? 0) - (from.airbrake ?? 0)) * u);
      if (mate.key === "sailplane" && to.tow) {
        mate.towVisuals ??= new TowVisuals();
        const tow = { ...to.tow };
        if (from.tow) for (const key of ["lat", "lon", "height", "heading", "pitch"]) tow[key] = from.tow[key] + (to.tow[key] - from.tow[key]) * u;
        mate.towVisuals.update(scene, frameAt, mate.mesh, tow, paused ? 0 : dt);
      } else mate.towVisuals?.dispose();
      const mateVertical = PLANES[mate.key].vertical;
      if (mateVertical && to.booster) syncBooster(mate.mesh, scene, to.booster, tiles.group.matrixWorld, vehicleGroundShadows);
      else if (mateVertical && falconState(mate.mesh)?.boosterReleased) resetFalcon9(mate.mesh);
      const mateThrottle = to.throttle ?? .6;
      updateRocketExhaust(mate.mesh, dt, mateVertical ? mateThrottle * 15000 : kmh, !paused && (!mateVertical || mateThrottle > .02));
      if (mateVertical && to.dragonReleased && !falconState(mate.mesh)?.released) {
        const up = new Vector3(0, 1, 0).applyQuaternion(skyQuat);
        const velocity = new Vector3(0, kmh / 3.6, 0).applyQuaternion(mateQuat);
        releaseDragon(mate.mesh, scene, velocity, up, vehicleGroundShadows);
      } else if (mateVertical && !to.dragonReleased) resetDragon(mate.mesh);
      mate.kmh = kmh;
      const marker = ensureMateMarker(mate);
      const markOn = mp.goAt && performance.now() - mp.goAt < MATE_MARKER_MS;
      mateUp.set(0, 1, 0).applyQuaternion(mateQuat).normalize();
      marker.scale.copy(mateScale);
      marker.position
        .copy(matePos)
        .addScaledVector(mateUp, 18 * (mateScale.y || 1));
      marker.quaternion.copy(mateQuat);
      marker.visible = markOn && Math.sin(performance.now() * 0.014) > 0;
    }
  } else {
    hideAllMates();
  }
  for (const mate of mp.mates.values()) {
    updateDragon(mate.mesh, dt, tiles.group, !paused && !menuOpen, mp.active && !menuOpen && !!mate.mesh?.visible);
    updateBooster(mate.mesh, dt, tiles.group, { active: !paused && !menuOpen, visible: mp.active && !menuOpen && !!mate.mesh?.visible });
  }

  // Zewnętrzne kamery trzymają poziom; widok z dzioba śledzi pełną orientację.
  const camFrame = frameAt(
    plane.lat,
    plane.lon,
    plane.height,
    plane.heading,
    0,
    0
  );
  camFrame.decompose(camFramePos, camFrameQuat, camFrameScale);
  if (plane.isLunar && plane.height > 100000) camFrameQuat.copy(planeQuat);
  flightCamera.update(camOffset, planePos, planeQuat, camFrameQuat);
  camInit = true;
  camera.position.copy(camPos);
  // trzęsienie kamery po wybuchu
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 1.3);
    const s = flightCamera.fixed ? 0 : shake * shake * 7;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
  }
  camera.up.copy(flightCamera.up);
  camera.lookAt(camTarget);

  // kopuła nieba i słońce w LOKALNEJ ramce północnej (bez kursu) —
  // globalna oś Y jest przechylona ~38° względem horyzontu na szer. 52°N,
  // co dawało ukośną granicę nieba i błękitną poświatę
  if (!flightCamera.fixed) {
    frameAt(plane.lat, plane.lon, plane.height, 0, 0, 0).decompose(
      skyFramePos,
      skyQuat,
      skyFrameScale
    );
  }
  sky.mesh.position.copy(camPos);
  sky.mesh.quaternion.copy(skyQuat);
  solar = solarPosition(Date.now());
  localSun = localSolarState(solar, plane.lat, plane.lon, plane.height);
  sky.update(plane.height, clock.elapsedTime, scene.fog, localSun);
  moonPositionECEF(spaceTime, spaceMoon);
  spaceSun.copy(solar.sunInertial);
  WGS84_ELLIPSOID.getCartographicToPosition(plane.lat, plane.lon, plane.height, spaceObserver);
  const sunECEF = solar.sunECEF;
  const mapOrientation = new Quaternion().setFromRotationMatrix(tiles.group.matrixWorld);
  physicalSunWorld.copy(sunECEF).applyQuaternion(mapOrientation);
  sky.uniforms.uSunDir.value.copy(physicalSunWorld).applyQuaternion(skyQuat.clone().invert());
  const stars = sky.mesh.getObjectByName("space-stars");
  if (stars) stars.quaternion.copy(skyQuat).invert().multiply(mapOrientation).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -solar.siderealAngle));
  spaceScene.update({ camera, mapMatrix: tiles.group.matrixWorld, moonECEF: spaceMoon, sunECEF,
    altitude: plane.height, active: !menuOpen, observerECEF: spaceObserver,
    siderealAngle: solar.siderealAngle, moonSiderealAngle: spaceTime * SPACE_CONSTANTS.EARTH_ANGULAR_SPEED });
  magnetosphere.setVisible(!menuOpen && spaceScene.overview && document.getElementById("magnetosphere-toggle").checked);
  magnetosphere.update({ sunDirection: spaceSun, siderealTime: solar.siderealAngle,
    time: spaceTime, solarPressure, orientation: spaceScene.inertialOrientation, metersToWorld: SPACE_RENDER_SCALE });
  if (frameCount % 4 === 0) updateSpaceHud();

  sun.position.copy(physicalSunWorld).multiplyScalar(700).add(planePos);
  const inSpace = plane.height > 120000;
  document.body.classList.toggle("in-space", !menuOpen && inSpace);
  document.body.classList.toggle("space-overview", !menuOpen && spaceScene.overview);
  if (plane.height >= 100000) hidePlaceBadge();
  ambientLight.intensity = inSpace ? .14 : localSun.ambientIntensity;
  ambientLight.position.set(0, 1, 0).applyQuaternion(skyQuat);
  ambientLight.color.set(inSpace ? 0xc8d6ef : 0xbfd8ee);
  ambientLight.groundColor.set(inSpace ? 0xc8d6ef : 0x5a7048);
  sun.intensity = inSpace ? 2.8 * localSun.sunlight : localSun.sunIntensity;
  if (inSpace) sun.color.set(0xffffff);
  else sun.color.copy(sky.uniforms.uSunColor.value);
  sun.castShadow = !isMobile && !inSpace && localSun.sunlight > .01;
  scene.environmentIntensity = inSpace ? .08 : localSun.environmentIntensity;
  terrainDayNight.update(physicalSunWorld, earthCentreWorld.setFromMatrixPosition(tiles.group.matrixWorld));
  flightClock.update({ utcMs: solar.utcMs, latDeg: plane.latDeg, lonDeg: plane.lonDeg, phase: localSun.phase, inSpace,
    hidden: menuOpen || guessOpen || leaveOpen || freeMap.open });
  sun.target.position.copy(planePos);
  sun.target.updateMatrixWorld();

  if (!liteMode && !menuOpen && plane.height < 100000 && frameCount % 15 === 0) {
    tiles.group.traverse((o) => {
      if (o.isMesh && !o.castShadow && !o.userData.vehicleShadowReceiver) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
  }

  // poszerzenie FOV przy nitrie — efekt prędkości
  const targetFov = !plane.isLunar && !plane.isBalloon && plane.speed > plane.cruise * 1.2 ? 78 : 70;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, 3 * dt);
    camera.updateProjectionMatrix();
  }

  if ((!menuOpen || awaitingSnap) && plane.height < 100000 && frameCount % 8 === 0) {
    const snapping = pendingSnap || awaitingSnap;
    const refH = snapping
      ? Math.max(plane.height, spawnHoldAlt(), 10000)
      : Math.max(plane.height, 2500);
    const col = probeColumn(plane.lat, plane.lon, refH);
    const surf = col.surface;
    if (surf !== null) lastSurf = surf;
    const gh = snapping ? surf : col.ground;
    if (
      surf !== null &&
      !pendingSnap &&
      !crashed &&
      performance.now() < crashGraceUntil &&
      plane.height < surf + 80
    ) {
      plane.height = surf + snapAgl();
      adoptGround(surf);
    } else if (gh !== null) {
      adoptGround(gh);
    }
    if (pendingSnap && surf !== null) {
      snapBestGh = snapBestGh == null ? surf : Math.max(snapBestGh, surf);
      plane.height = snapBestGh + snapAgl();
      if (!snapFirstAt) snapFirstAt = performance.now();
      if (snapLastGh !== null && Math.abs(surf - snapLastGh) < 30) {
        snapStableCount += 1;
      } else {
        snapStableCount = 0;
      }
      snapLastGh = surf;
      const busy = tilesBusy();
      const need = busy ? 8 : 4;
      const waited = performance.now() - snapFirstAt > (busy ? 2800 : 1800);
      if (snapStableCount >= need && waited) {
        pendingSnap = false;
        armCrashGrace();
        if (awaitingSnap) {
          awaitingSnap = false;
          if (mp.active && mp.inRound) reportSnapped();
          else finishSnapStart();
        }
      }
    }
  }
  if (awaitingSnap && performance.now() - awaitingSnapSince > 20000) {
    awaitingSnap = false;
    pendingSnap = false;
    armCrashGrace();
    const gh = Number.isFinite(snapBestGh)
      ? snapBestGh
      : Number.isFinite(snapLastGh)
      ? snapLastGh
      : null;
    if (gh !== null) {
      plane.height = gh + snapAgl();
      groundAlt = gh;
    }
    if (mp.active && mp.inRound) reportSnapped();
    else finishSnapStart();
  }
  const agl = plane.height - groundAlt;
  // aktywne wybuchy
  const weaponsActive = !menuOpen && !paused && !guessOpen && !leaveOpen;
  fighterMissiles?.update(dt, { terrain: tiles.group, active: weaponsActive, visible: !menuOpen && !guessOpen });
  if (menuOpen || guessOpen || leaveOpen || crashed || finished || pendingSnap || awaitingSnap || freeMap.open) {
    droneCannons?.cancelBurst(planeMesh);
  }
  droneCannons?.update(dt, { terrain: tiles.group, active: weaponsActive, visible: !menuOpen && !guessOpen });
  for (let i = explosions.length - 1; i >= 0; i--) {
    if (!explosions[i].update(weaponsActive ? dt : 0)) explosions.splice(i, 1);
  }

  // latarnia domu — tylko z bliska, inaczej widać ją z całego lotu
  if (beacon && mode === "home" && homeTarget && !finished && !menuOpen) {
    const dist = distanceM(
      plane.latDeg,
      plane.lonDeg,
      homeTarget.lat,
      homeTarget.lon
    );
    const show = dist <= HOME_BEACON_M;
    if (show && (!beaconGrounded || frameCount % 60 === 0)) {
      placeBeaconAt(homeTarget.lat, homeTarget.lon);
    }
    beacon.visible = show;
    if (show) beacon.userData.ring.rotation.z += dt * 0.8;
  } else if (beacon) {
    beacon.visible = false;
  }

  // tryby: timer + warunki wygranej
  if (
    timerActive &&
    !pendingSnap &&
    !awaitingSnap &&
    !menuOpen &&
    !paused &&
    !guessOpen &&
    !finished &&
    (!crashed || mp.active)
  ) {
    timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      timerActive = false;
      if (mode === "home") {
        finished = true;
        if (plane) homePath.push({ lat: plane.latDeg, lon: plane.lonDeg });
        showBanner("TIME'S UP");
      } else if (mode === "guess") {
        openGuessMap();
      }
    }
  }
  if (mp.active && guessOpen && !paused && mp.inRound) {
    if (mp.phase === "mark" && !guessAnswered) {
      mp.markLeft -= dt;
      if (frameCount % 8 === 0) updateGuessPhaseUi();
      if (mp.markLeft <= 0) revealMpGuesses(true);
    } else if (mp.phase === "results") {
      mp.resultsLeft -= dt;
      if (frameCount % 8 === 0) updateGuessPhaseUi();
      if (mp.resultsLeft <= 0 && mp.host && !mp.launching) {
        if (humansWantPlay()) launchMpRound();
        else {
          finishRoomRound();
          mp.phase = "lobby";
          broadcastRoster();
        }
      }
    }
  }
  tickHostRound(dt);
  if (mp.active && !mp.host && menuOpen && mp.roundActive && !mp.inRound) {
    mp.phaseLeft = Math.max(0, (mp.phaseLeft || 0) - dt);
  }
  if (mp.active && menuOpen && !mp.inRound && frameCount % 20 === 0) {
    if (el.lobbyPhase) el.lobbyPhase.textContent = lobbyPhaseText();
  }
  if (mode === "home" && flying && frameCount % 8 === 0) recordHomePath();
  if (mode === "home" && homeTarget && flying) {
    const dist = distanceM(
      plane.latDeg,
      plane.lonDeg,
      homeTarget.lat,
      homeTarget.lon
    );
    if (dist < HOME_CAPTURE_M) {
      finished = true;
      timerActive = false;
      beacon.visible = false;
      homePath.push({ lat: homeTarget.lat, lon: homeTarget.lon });
      showBanner("YOU MADE IT HOME!");
    }
  }

  // HUD
  if (frameCount % 2 === 0) {
    updateHud(agl);
    syncGuessHud();
  }
  if (frameCount % 4 === 0) syncTouchUi();
  if (mode === "free" && !menuOpen && frameCount % 90 === 0) syncPlaceBadge();
  if (frameCount % 2 === 0) updateLocationMaps();

  if (menuOpen) {
    tiles.group.visible = false;
    if (planeMesh) planeMesh.visible = false;
    if (awaitingSnap) {
      tiles.setResolutionFromRenderer(camera, renderer);
      tiles.setCamera(camera);
      camera.updateMatrixWorld();
      retryFailedTiles();
      updateTilesSafe();
    }
  } else if (plane.height < 200000) {
    tiles.group.visible = true;
    if (planeMesh && !crashed) planeMesh.visible = true;
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.setCamera(camera);
    camera.updateMatrixWorld();
    retryFailedTiles();
    updateTilesSafe();
  } else {
    tiles.group.visible = false;
    if (planeMesh && !crashed) planeMesh.visible = true;
  }

  updateContrails(planeMesh, dt, plane.kmh, flying && !crashed && !menuOpen && plane.height < 30000, camera);
  for (const mate of mp.mates.values()) {
    updateContrails(mate.mesh, dt, mate.kmh ?? 0,
      mp.active && !menuOpen && !paused && !guessOpen && !!mate.mesh?.visible, camera);
  }
  shadowUp.set(0, 1, 0).applyQuaternion(skyQuat);
  shadowSunDirection.copy(physicalSunWorld);
  vehicleGroundShadows?.update(dt, {
    terrain: tiles.group,
    camera,
    up: shadowUp,
    sunDirection: shadowSunDirection,
    active: !menuOpen && !pendingSnap && !awaitingSnap && plane.height < 100000 && localSun.sunlight > .05,
  });
  liveTraffic?.update({
    active: !menuOpen && !paused && !guessOpen && !leaveOpen && !crashed && !finished && !pendingSnap && !awaitingSnap && !freeMap.open && !window.__ctxLost && plane.height < 100000,
    speedMps: plane.speed,
    viewportHeight: innerHeight,
  });
  spaceScene.render(renderer, scene, camera);

  const mateDbg = [];
  for (const [id, mate] of mp.mates) {
    mateDbg.push({
      id,
      visible: !!mate.mesh?.visible,
      dist: mate.mesh
        ? Math.round(mate.mesh.position.distanceTo(planePos))
        : -1,
      hasPose: mp.poses.has(id),
      samples: mp.poses.get(id)?.samples?.length || 0,
    });
  }
  window.__dbg = {
    frame: frameCount,
    children: tiles.group.children.length,
    speed: plane.speed,
    height: plane.height,
    groundAlt,
    lat: plane.latDeg,
    lon: plane.lonDeg,
    mode,
    timeLeft,
    ctxLost: !!window.__ctxLost,
    loading: tiles.isLoading,
    visibleTiles: tiles.visibleTiles?.size ?? -1,
    tileFailed: tiles.stats?.failed ?? -1,
    tileQueued: tiles.stats?.queued ?? -1,
    tileDown: tiles.stats?.downloading ?? -1,
    tileLoaded: tiles.stats?.loaded ?? -1,
    tile429: tile429Count,
    tileJobs: tiles.downloadQueue?.maxJobsPerOrigin ?? -1,
    tileErr: lastTileErr,
    memJs: performance.memory
      ? Math.round(performance.memory.usedJSHeapSize / 1048576)
      : -1,
    memTex: renderer.info?.memory?.textures ?? -1,
    memGeo: renderer.info?.memory?.geometries ?? -1,
    memCache: tiles.lruCache
      ? Math.round((tiles.lruCache.cachedBytes || 0) / 1048576)
      : -1,
    tilePool: tilePool.debug(),
    explosions: explosions.length,
    crashed,
    pendingSnap,
    awaitingSnap,
    snapBestGh,
    surf: lastSurf,
    agl: plane.height - groundAlt,
    buried: lastSurf != null && plane.height < lastSurf + 20,
    audio: engineDebug(),
    music: musicDebug(),
    camDist: camera.position.distanceTo(planePos),
    camOffset,
    cameraMode: FLIGHT_CAMERAS[flightCamera.mode].name,
    mpActive: mp.active,
    inRound: mp.inRound,
    menuOpen,
    poses: mp.poses.size,
    mates: mateDbg,
  };
  window.__cam = camera;
  window.__planeMesh = planeMesh;
}

window.__forceTestMate = () => {
  mp.active = true;
  menuOpen = false;
  paused = true;
  el.menu.classList.add("hidden");
  el.landing.classList.add("hidden");
  el.lobby.classList.add("hidden");
  hideMpWait();
  const R = 6378137;
  const aheadM = 35;
  const eastM = 10;
  const lat = plane.latDeg + (aheadM / R) * (180 / Math.PI);
  const lon =
    plane.lonDeg + (eastM / (R * Math.cos(plane.lat))) * (180 / Math.PI);
  seedMatePose("test-mate", lat, lon, plane.height, selectedPlane);
  mp.goAt = performance.now();
};

function updateHud(agl) {
  // skala prędkościomierza pod najszybszy pojazd (nitro), zaokrąglona w górę
  const kmh = plane.isLunar && plane.height < 100000 ? plane.velocity.length() * 3.6 : plane.kmh;
  const maxKmh = plane.isLunar ? Math.max(2000, Math.ceil(kmh / 10000) * 10000) : plane.isBalloon ? 60 : Math.ceil((PLANES[selectedPlane].boost * 3.6) / 200) * 200;
  if (el.gSpeed?.clientWidth) drawAirspeed(el.gSpeed, kmh, maxKmh);
  if (el.gAlt?.clientWidth) drawAltimeter(el.gAlt, Math.max(0, agl));
  if (el.gHdg?.clientWidth) drawCompass(el.gHdg, plane.headingDeg);

  if (timerActive || mode !== "free") {
    const tsec = Math.max(0, Math.ceil(timeLeft));
    const mm = Math.floor(tsec / 60);
    const ss = String(tsec % 60).padStart(2, "0");
    el.timer.textContent = `${mm}:${ss}`;
    el.timer.classList.toggle("low", tsec <= 30 && timerActive);
  }
  if (mode === "home" && homeTarget) {
    const dist = distanceM(
      plane.latDeg,
      plane.lonDeg,
      homeTarget.lat,
      homeTarget.lon
    );
    el.dist.textContent = `${(dist / 1000).toFixed(1)} km`;
  }
}

function recordHomePath() {
  if (mode !== "home" || !plane || pendingSnap || awaitingSnap || menuOpen)
    return;
  const lat = plane.latDeg;
  const lon = plane.lonDeg;
  const last = homePath[homePath.length - 1];
  if (last && distanceM(last.lat, last.lon, lat, lon) < 90) return;
  homePath.push({ lat, lon });
  if (homePath.length > 900) homePath.splice(0, homePath.length - 800);
}

function showHomeTrail() {
  if (!el.homeTrail || !el.banner) return false;
  if (mode !== "home") return false;
  const start = { lat: startLat, lon: startLon };
  const home = homeTarget ? { lat: homeTarget.lat, lon: homeTarget.lon } : null;
  if (!home && homePath.length < 2) return false;
  el.homeTrail.hidden = false;
  el.banner.classList.add("trail");
  requestAnimationFrame(() => {
    paintTrailMap(el.homeTrail, { path: homePath, start, home });
  });
  return true;
}

function showBanner(title, sub = "") {
  if (!el.banner) return;
  el.banner.querySelector(".b-title").textContent = title;
  const subEl = el.banner.querySelector(".b-sub");
  subEl.textContent = sub;
  subEl.style.display = sub ? "" : "none";
  if (!showHomeTrail()) {
    if (el.homeTrail) el.homeTrail.hidden = true;
    el.banner.classList.remove("trail");
  }
  el.banner.classList.add("show");
}

function hideBanner() {
  if (el.banner) {
    el.banner.classList.remove("show", "trail");
  }
  if (el.homeTrail) el.homeTrail.hidden = true;
}
