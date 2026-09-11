import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, PerspectiveCamera, Raycaster, Scene, Vector3 } from 'three';
import { SpaceScene, SPACE_RENDER_SCALE as SCALE } from '../src/game/spaceScene.js';
import { SPACE_CONSTANTS as C, MOON_ORBIT_NORMAL, moonPositionECEF, inertialToECEF, sunDirectionInertial } from '../src/game/spacePhysics.js';
import { lunarTerrainHeight } from '../src/game/lunarTerrain.js';
import { SOLAR_BODY_BY_ID, bodyPositionInertial } from '../src/game/solarSystem.js';
import { solarPosition } from '../src/game/dayNight.js';

// No WebGL or network is needed to check the actual scene geometry/transforms.
const element = () => ({style:{},addEventListener(){},removeEventListener(){},remove(){},append(){}});
function sceneFixture(t) {
  const previous = globalThis.document;
  globalThis.document = { createElementNS: element, createElement: element, getElementById: () => null };
  const canvas = {...element(), getRootNode: element};
  const main = new Scene(), space = new SpaceScene(main, canvas, {simple:true});
  t.after(() => {space.dispose(); globalThis.document=previous;});
  const mapMatrix = new Matrix4().makeRotationX(-Math.PI / 2), camera = new PerspectiveCamera(70, 1.6, .5, 1e8);
  function update(time, observer, overview=false) {
    space.setOverview(overview);
    camera.position.copy(observer).applyMatrix4(mapMatrix);
    space.update({camera,mapMatrix,moonECEF:moonPositionECEF(time),sunECEF:inertialToECEF(sunDirectionInertial(time),time),altitude:observer.length()-C.EARTH_EQUATORIAL_RADIUS,active:true,observerECEF:observer,siderealAngle:time*C.EARTH_ANGULAR_SPEED});
  }
  return {main,space,camera,mapMatrix,update};
}

test('the rendered Moon, spacecraft and orbital pole share physical distances in flight and overview', t => {
  const {space,mapMatrix,update}=sceneFixture(t);
  for(const time of [0,86164/4,34200]) {
    const moon=moonPositionECEF(time), observer=moon.clone().addScaledVector(moon.clone().normalize(),-C.MOON_RADIUS-19);
    for(const overview of [false,true]) {
      update(time,observer,overview);
      assert(Math.abs(space.moonWorld.length()/SCALE-C.MOON_DISTANCE)<1e-6);
      assert(Math.abs(space.shipWorld.distanceTo(space.moonWorld)/SCALE-C.MOON_RADIUS-19)<1e-6);
      const renderedPole=new Vector3(0,0,1).applyQuaternion(space.moon.quaternion);
      const expectedPole=MOON_ORBIT_NORMAL.clone().applyQuaternion(space.inertialOrientation);
      assert(renderedPole.distanceTo(expectedPole)<1e-9);
      if(!overview)assert(space.shipWorld.clone().divideScalar(SCALE).distanceTo(observer.clone().applyMatrix4(mapMatrix))<1e-6);
    }
  }
});

test('overview exposes west-to-east sidereal spin while its inertial frame keeps the 23.44 degree obliquity', t => {
  const {space,update}=sceneFixture(t);
  update(0,new Vector3(C.EARTH_EQUATORIAL_RADIUS+1000000,0,0),true);
  const axis0=new Vector3(0,0,1).applyQuaternion(space.earth.quaternion);
  const equator0=new Vector3(1,0,0).applyQuaternion(space.earth.quaternion);
  update(C.EARTH_SIDEREAL_PERIOD/4,new Vector3(C.EARTH_EQUATORIAL_RADIUS+1000000,0,0),true);
  const axis1=new Vector3(0,0,1).applyQuaternion(space.earth.quaternion);
  const equator1=new Vector3(1,0,0).applyQuaternion(space.earth.quaternion);
  assert(axis0.distanceTo(axis1)<1e-9);
  assert(Math.abs(Math.acos(axis1.y)-C.EARTH_AXIAL_TILT)<1e-9);
  assert(Math.abs(equator0.dot(equator1))<1e-9);
  assert(new Vector3().crossVectors(equator0,equator1).dot(axis1)>.999999);
});

test('live sunlight illuminates the same geographic point in flight and globe view independently of lunar mission time', t => {
  const {space, camera, mapMatrix} = sceneFixture(t);
  const solar = solarPosition(Date.parse('2026-09-10T12:00:00Z'));
  const observer = solar.sunECEF.clone().multiplyScalar(C.EARTH_EQUATORIAL_RADIUS + 1000000);
  const missionTime = 34200, moonECEF = moonPositionECEF(missionTime);
  for (const overview of [false, true]) {
    space.setOverview(overview);
    space.update({camera, mapMatrix, moonECEF, sunECEF: solar.sunECEF, altitude: 1000000,
      active: true, observerECEF: observer, siderealAngle: solar.siderealAngle,
      moonSiderealAngle: missionTime * C.EARTH_ANGULAR_SPEED});
    const surfaceNormal = solar.sunECEF.clone().applyQuaternion(space.earth.quaternion);
    assert(surfaceNormal.dot(space.sun.position.clone().normalize()) > .999999);
    const pole = new Vector3(0, 0, 1).applyQuaternion(space.moon.quaternion);
    const expected = inertialToECEF(MOON_ORBIT_NORMAL, missionTime).applyQuaternion(space.ecefOrientation);
    assert(pole.distanceTo(expected) < 1e-9, 'lunar surface and its pole retain the mission physics frame');
  }
});

test('lunar contact patch has outward faces, continuous seam UVs and matches the physical relief', t => {
  const {space,mapMatrix,update}=sceneFixture(t);
  for(const sign of [-1,1]) {
    const time=34200,moon=moonPositionECEF(time),up=moon.clone().normalize().multiplyScalar(sign);
    const observer=moon.clone().addScaledVector(up,C.MOON_RADIUS+19);
    update(time,observer);
    assert(space.patch.visible);
    space.patch.updateMatrixWorld(true);
    const surface=moon.clone().addScaledVector(up,C.MOON_RADIUS).applyMatrix4(mapMatrix);
    const worldUp=up.clone().transformDirection(mapMatrix);
    const ray=new Raycaster(surface.clone().addScaledVector(worldUp,19),worldUp.clone().negate(),0,30);
    const hits=ray.intersectObject(space.patch,false);
    assert(hits.length>0);
    assert(Math.abs(hits[0].distance-19)<.15);
    const {position,uv}=space.patch.geometry.attributes;
    const count = space.patch.geometry.userData.gridCount;
    let minHeight = Infinity, maxHeight = -Infinity;
    for(let row=0;row<=count;row++)for(let col=0;col<count;col++){
      const a=row*(count+1)+col;
      assert(Math.abs(uv.getX(a)-uv.getX(a+1))<.01,'no wraparound interpolation across the lunar map');
      const point=new Vector3().fromBufferAttribute(position,a).applyQuaternion(space.patchBasis).add(space.patchAnchor);
      const height = point.length() - C.MOON_RADIUS;
      assert(Math.abs(height - lunarTerrainHeight(point)) < .03, 'drawn vertices agree with collision surface');
      minHeight = Math.min(minHeight, height); maxHeight = Math.max(maxHeight, height);
    }
    assert(maxHeight - minHeight > 80, "the visible mesh has real relief, not only a texture");
  }
});


test('all planets render at their physical position and the full system and body views can frame them', t => {
  const { space, update } = sceneFixture(t);
  const observer = new Vector3(C.EARTH_EQUATORIAL_RADIUS + 1e6, 0, 0);
  update(0, observer, true);
  assert.equal(space.bodies.size, 10);
  assert(space.bodies.get('saturn').getObjectByName('saturn-rings'));
  for (const id of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'sun']) {
    const mesh = space.bodies.get(id);
    const expected = bodyPositionInertial(id, 0).applyQuaternion(space.ecefOrientation).multiplyScalar(SCALE);
    assert(mesh.position.distanceTo(expected) < 1e-8);
    space.setOverviewMode('body', id); update(0, observer, true);
    assert(mesh.position.distanceTo(space.controls.target) < 1e-8);
    assert(space.camera.position.distanceTo(mesh.position) > mesh.userData.radius);
    const projected = mesh.position.clone().project(space.camera);
    assert(Math.abs(projected.x) < .6 && Math.abs(projected.y) < .6 && projected.z < 1);
  }
  space.setOverviewMode('solar'); update(0, observer, true);
  assert(space.orbits.visible);
  for (const id of ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
    const mesh = space.bodies.get(id), projected = mesh.position.clone().project(space.camera);
    assert(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && projected.z < 1, `${id} lies in the full-system view`);
    assert(mesh.scale.x >= 1);
  }
  update(0, observer, false);
  assert.equal(space.bodies.get('neptune').scale.x, 1, 'flight restores physical radii');
  assert.equal(space.orbits.visible, false);
});
