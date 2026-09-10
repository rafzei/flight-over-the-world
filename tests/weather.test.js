import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, PerspectiveCamera, Scene, Vector3 } from 'three';
import { solarPosition } from '../src/game/dayNight.js';
import { windAt, sampleWeather, thermalCenter, moveGeo } from '../src/game/weather.js';
import { WeatherVisuals } from '../src/game/weatherVisuals.js';
import { PlaneController } from '../src/game/plane.js';
import { SailplaneController } from '../src/game/sailplane.js';
import { BalloonController } from '../src/game/balloon.js';
import { DroneController } from '../src/game/vehicleControllers.js';
import { LunarController } from '../src/game/lunarController.js';
import { ecefToGeodetic, localBasis } from '../src/game/spacePhysics.js';
const utcMs=Date.parse('2026-06-21T11:00:00Z'), solar=solarPosition(utcMs);
const location={lat:52.23*Math.PI/180,lon:21.01*Math.PI/180,height:1100,ground:100,utcMs,solar};
const input={roll:0,pitch:0,throttle:.5};

test('weather is shared, continuous across the dateline, bounded at poles and fades out of the atmosphere',()=>{
  assert.deepEqual(sampleWeather(location),sampleWeather({...location}));
  const a=windAt(.5,Math.PI,1500,utcMs),b=windAt(.5,-Math.PI,1500,utcMs);
  assert(Math.abs(a.north-b.north)<1e-8);assert(Math.abs(a.east-b.east)<1e-8);
  const low=windAt(location.lat,location.lon,300,utcMs),high=windAt(location.lat,location.lon,2000,utcMs);
  assert(Math.abs(Math.atan2(low.east,low.north)-Math.atan2(high.east,high.north))>.5);
  for(const lat of [-Math.PI/2,Math.PI/2]) {
    const w=sampleWeather({...location,lat});assert(w.thermals.length<=64);
    assert([w.north,w.east,w.up,...Object.values(moveGeo(lat,0,100,100))].every(Number.isFinite));
  }
  const space=sampleWeather({...location,height:25000});
  assert.equal(space.speed,0);assert.equal(space.up,0);assert.equal(space.thermals.length,0);
});

test('sunlit thermal cores lift a glider, vanish at night and do not extend underground or above cloud base',()=>{
  const weather=sampleWeather(location),cell=weather.thermals.find(c=>c.strength>3);
  assert(cell,'daytime cells must include useful soaring lift');
  const center=thermalCenter(cell,location.height,utcMs);
  const core=sampleWeather({...location,...center});assert(core.up>1.5);
  const glider=new SailplaneController(center.lat*180/Math.PI,center.lon*180/Math.PI,location.height,0);
  const start=glider.height;glider.update(1,{...input,weather:core});assert(glider.height>start);assert(glider.verticalSpeed>0);
  const night=Date.parse('2026-06-21T23:00:00Z');
  const dark=sampleWeather({...location,...center,utcMs:night,solar:solarPosition(night)});
  assert.equal(dark.up,0);assert.equal(dark.nearest,null);assert(dark.thermals.every(c=>c.strength===0));
  assert.equal(sampleWeather({...location,...center,height:99}).up,0);
  assert.equal(sampleWeather({...location,...center,height:4000}).up,0);
});

test('wind changes ground track without creating airspeed and lift is applied once across frame rates',()=>{
  for(const Controller of [PlaneController,SailplaneController,DroneController]) {
    const calm=new Controller(52,21,1000,0),windy=new Controller(52,21,1000,0);
    for(let i=0;i<120;i++) {calm.update(1/120,input);windy.update(1/120,{...input,weather:{north:0,east:12,up:3}});}
    assert(Math.abs(calm.speed-windy.speed)<1e-9);
    assert(Math.abs(windy.height-calm.height-3)<.01,Controller.name);
    assert(Math.abs((windy.lon-calm.lon)*6378137*Math.cos(calm.lat)-12)<.01);
  }
  const results=[];
  for(const dt of [1/30,1/60,1/120]) {
    const p=new PlaneController(52,21,1000,0);
    for(let i=0;i<10/dt;i++)p.update(dt,{...input,approach:true,approachSpeed:40,weather:{north:2,east:8,up:2}});
    results.push(p.height);assert(p.weatherVertical===2);assert(p.verticalSpeed<5);
  }
  assert(Math.max(...results)-Math.min(...results)<.2);
});

test('balloons follow shared wind with inertia and altitude changes select different wind layers',()=>{
  const a=new BalloonController(52,21,300,0),b=new BalloonController(52,21,1900,0);
  for(let i=0;i<3600;i++)for(const p of [a,b])p.update(1/120,{...input,weather:windAt(p.lat,p.lon,p.height,utcMs)});
  const wa=windAt(a.lat,a.lon,a.height,utcMs),wb=windAt(b.lat,b.lon,b.height,utcMs);
  assert(Math.abs(a.northSpeed-wa.north)<.05);assert(Math.abs(b.eastSpeed-wb.east)<.05);
  assert(Math.hypot(a.northSpeed-b.northSpeed,a.eastSpeed-b.eastSpeed)>3);
  const before={...a};a.update(0,{...input,weather:{north:100,east:100,up:10}});assert.deepEqual({...a},before);
});

test('clouds and optional thermal guides have geographic positions and stay within instancing limits',()=>{
  const scene=new Scene(),visuals=new WeatherVisuals(scene),camera=new PerspectiveCamera(),map=new Matrix4();
  const weather=sampleWeather(location);
  visuals.update(weather,location,camera,map,{markers:true});
  assert(visuals.clouds.count>0 && visuals.clouds.count<=320);assert(visuals.columns.count>0&&visuals.columns.count<=64);
  const first=new Matrix4();visuals.clouds.getMatrixAt(0,first);
  camera.position.x=1000;
  visuals.update(weather,location,camera,map,{markers:false});
  const second=new Matrix4();visuals.clouds.getMatrixAt(0,second);
  assert(Math.abs(first.elements[12]-second.elements[12]-1000)<.5);assert.equal(visuals.columns.count,0);
  visuals.update(weather,location,camera,map,{hidden:true});assert.equal(visuals.clouds.count,0);
  visuals.dispose();assert.equal(scene.children.length,0);
});

test('rocket wind acts through atmospheric drag in the local east direction, with no force in space',()=>{
  const p=new LunarController(52,21,1000,0,{vertical:true,cruise:0});
  const calm=p._acceleration(0,new Vector3());
  p.weather={north:0,east:15,up:0};
  const gust=p._acceleration(0,new Vector3()).sub(calm);
  const {lat,lon}=ecefToGeodetic(p.positionInertial);
  assert(gust.dot(localBasis(lat,lon).east)>0);
  p.height=30000;p.rebaseFromGeodetic();
  const above=p._acceleration(0,new Vector3());p.weather=null;
  assert(above.distanceTo(p._acceleration(0,new Vector3()))<1e-12);
});
