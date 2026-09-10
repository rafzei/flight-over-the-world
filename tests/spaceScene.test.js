import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, PerspectiveCamera, Raycaster, Scene, Vector3 } from 'three';
import { SpaceScene, SPACE_RENDER_SCALE as SCALE } from '../src/game/spaceScene.js';
import { SPACE_CONSTANTS as C, MOON_ORBIT_NORMAL, moonPositionECEF, inertialToECEF, sunDirectionInertial } from '../src/game/spacePhysics.js';
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

test('lunar contact patch has outward faces, continuous seam UVs and sub-metre spherical accuracy', t => {
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
    for(let row=0;row<=64;row++)for(let col=0;col<64;col++){
      const a=row*65+col;
      assert(Math.abs(uv.getX(a)-uv.getX(a+1))<.01,'no wraparound interpolation across the lunar map');
      const point=new Vector3().fromBufferAttribute(position,a);point.y+=C.MOON_RADIUS;
      assert(Math.abs(point.length()-C.MOON_RADIUS)<.002);
    }
  }
});
