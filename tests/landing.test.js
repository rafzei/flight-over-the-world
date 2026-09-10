import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Group,Raycaster,Vector3} from 'three';
import {createAirliner} from '../src/game/airliner.js';
import {PlaneController} from '../src/game/plane.js';
import {attachLandingGear} from '../src/game/landingGear.js';
import {LandingSystem,flightPose} from '../src/game/landingDynamics.js';
import {WarsawRunway} from '../src/game/warsawRunway.js';
import {disposeModelResources} from '../src/game/vehicleModels.js';

function rig(key='b738'){
  const runway=new WarsawRunway(),system=new LandingSystem(runway),model=createAirliner(key),wrapper=new Group();
  const box=new Box3().setFromObject(model);model.position.sub(box.getCenter(new Vector3()));wrapper.add(model);
  const gear=attachLandingGear(wrapper,model,key);system.gear=gear;
  const position=runway.pose(0,runway.definition.threshold+350,20);
  const plane=new PlaneController(position.lat*180/Math.PI,position.lon*180/Math.PI,position.height,332,{cruise:72,boost:270,brake:70});
  plane.speed=gear.speed;plane.pitch=3*Math.PI/180;
  return {runway,system,gear,plane,dispose(){gear.dispose();disposeModelResources(model);}};
}
function descend(r,{sink=1.5,pitch=3,roll=0,heading=332,gear=1,speed=r.gear.speed,along=r.runway.definition.threshold+350,x=0}={}){
  const {system,plane,runway}=r;system.reset();r.gear.extension=gear;plane.pitch=pitch*Math.PI/180;plane.roll=roll*Math.PI/180;plane.heading=heading*Math.PI/180;plane.speed=speed;
  Object.assign(plane,runway.pose(x,along,18));
  let result;
  for(let i=0;i<1800&&!system.grounded&&!result?.crash&&system.status!=='bounced';i++){
    const before=flightPose(plane),p=runway.coordinates(plane);
    Object.assign(plane,runway.pose(p.x,-p.z+speed/60,p.y-sink/60));plane.verticalSpeed=-sink;
    result=system.resolve(plane,before,1/60);
  }
  return result;
}

test('737 and A320 touch down on their main wheels, settle all wheels, brake and stay stopped',()=>{
  for(const key of ['b738','a320','a321','e195']){
    const r=rig(key);descend(r);assert(r.system.grounded);assert.equal(r.system.touchdown.quality,'smooth');
    assert(Math.abs(Math.min(...r.system.feet(r.plane).map(w=>w.point.y)))<1e-6);
    r.plane.throttle=0;
    let distance=0;
    for(let i=0;i<1800&&r.system.status!=='stopped';i++){
      r.gear.update(1/60,r.plane.speed,true,r.system.touchdown.sink);
      const before=-r.runway.coordinates(r.plane).z,result=r.system.roll(r.plane,1/60,{throttle:0,roll:0,pitch:0,wheelBrake:true});
      assert(!result.crash);distance+=-r.runway.coordinates(r.plane).z-before;
    }
    assert.equal(r.system.status,'stopped');assert(distance>100&&distance<800);
    for(let i=0;i<120;i++)r.system.roll(r.plane,1/60,{throttle:0,roll:0,pitch:0,wheelBrake:true});
    assert.equal(r.plane.speed,0);assert(r.system.feet(r.plane).every(w=>Math.abs(w.point.y)<.02));
    const target=r.gear.target;r.gear.toggle(true);assert.equal(r.gear.target,target);r.dispose();
  }
});

test('belly, nose-first, excessive sink, bank, speed and cross-runway impacts cannot become a landing',()=>{
  for(const options of [{gear:0},{pitch:-6},{sink:9},{roll:20},{speed:160},{heading:355}]){
    const r=rig(),result=descend(r,options);assert(result?.crash,JSON.stringify(options));assert(!r.system.grounded);r.dispose();
  }
});

test('displaced threshold is not a touchdown zone; excessive sink can bounce; excursions fail',()=>{
  let r=rig();assert(descend(r,{along:20,sink:20}).crash);r.dispose();
  r=rig();descend(r,{sink:3.7});assert.equal(r.system.status,'bounced');assert(r.plane.verticalSpeed>0);r.dispose();
  r=rig();descend(r);Object.assign(r.plane,r.runway.pose(29,r.runway.definition.length-1,10));assert(r.system.roll(r.plane,1/60,{throttle:0,roll:0,pitch:0,wheelBrake:true}).crash);r.dispose();
});

test('approach dynamics retain descent through a flare and are stable across frame rates',()=>{
  const heights=[];
  for(const dt of [1/30,1/60,1/120]){
    const plane=new PlaneController(52,21,400,332,{cruise:72,boost:270,brake:70});plane.verticalSpeed=-3.77;
    const throttle=(72-72*.55)/(270-72*.55);plane.throttle=throttle;
    for(let i=0;i<Math.round(1/dt);i++)plane.update(dt,{throttle,roll:0,pitch:.32,approach:true,approachSpeed:72});
    assert(plane.pitch>0);assert(plane.verticalSpeed<0);heights.push(plane.height);
  }
  assert(Math.max(...heights)-Math.min(...heights)<.1);
});

test('takeoff accelerates from a standstill, rotates on the wheels and climbs clear of the runway',()=>{
  const r=rig();descend(r);
  r.plane.speed=0;r.plane.throttle=0;
  const ctrl={throttle:1,roll:0,pitch:1,wheelBrake:false,approach:true,approachSpeed:r.gear.speed};
  for(let i=0;i<6000&&r.system.grounded;i++){
    r.gear.update(1/60,r.plane.speed,true);
    const result=r.system.roll(r.plane,1/60,ctrl);
    assert(!result.crash);
    assert(r.system.feet(r.plane).every(w=>w.point.y>-.001),'rotation cannot push wheels through the runway');
  }
  assert(!r.system.grounded);assert(r.plane.verticalSpeed>0);
  for(let i=0;i<120;i++){
    const before=flightPose(r.plane);
    r.gear.update(1/60,r.plane.speed,false);
    r.plane.update(1/60,ctrl);
    assert(!r.system.resolve(r.plane,before,1/60).crash);
  }
  assert(!r.system.grounded);assert(r.system.feet(r.plane).every(w=>w.point.y>1));r.dispose();
});

test('gear travels over three simulation seconds and freezes while paused',()=>{
  const r=rig();r.gear.toggle(false);r.gear.update(1,72,false);
  assert(Math.abs(r.gear.extension-2/3)<1e-8);
  const before=r.gear.extension;r.gear.update(0,72,false);assert.equal(r.gear.extension,before);
  r.gear.update(2,72,false);assert(r.gear.extension<1e-8);assert(!r.gear.root.visible);
  r.gear.toggle(false);r.gear.update(3,72,false);assert.equal(r.gear.extension,1);
  r.gear.reset();assert.equal(r.gear.target,1);assert.equal(r.gear.compression,0);r.dispose();
});

test('generated struts reach the actual airframe and stay connected while retracting',()=>{
  for(const key of ['b738','a320','a321','e195']){
    const model=createAirliner(key),wrapper=new Group();
    model.position.sub(new Box3().setFromObject(model).getCenter(new Vector3()));wrapper.add(model);
    const gear=attachLandingGear(wrapper,model,key),contacts=gear.points().map(w=>w.point.toArray());
    for(const wheel of gear.wheels){
      const ray=new Raycaster(wheel.base.clone(),new Vector3(0,1,0)),hit=ray.intersectObject(model)[0];
      assert(hit,'wheel column must meet the airframe');
      const strut=new Box3().setFromObject(wheel.leg);
      assert(strut.max.y>=hit.point.y&&strut.max.y<hit.point.y+.10,'strut top must reach inside the underside');
      assert(Math.abs(strut.min.y-wheel.meshes[0].position.y)<1e-6,'strut bottom must reach the wheel axle');
    }
    gear.toggle(false);gear.update(1.5,72,false);wrapper.updateMatrixWorld(true);
    assert.deepEqual(gear.points().map(w=>w.point.toArray()),contacts,'visual retraction cannot move collision contact bases');
    for(const wheel of gear.wheels){
      const strut=new Box3().setFromObject(wheel.leg);
      assert(Math.abs(strut.max.y-wheel.mountY)<1e-6,'upper attachment stays fixed');
      assert(Math.abs(strut.min.y-wheel.meshes[0].position.y)<1e-6,'retracting wheel stays attached');
    }
    gear.dispose();disposeModelResources(model);
  }
});
