import { Matrix4, Vector3 } from "three";
import { CAMERA_FRAME, WGS84_ELLIPSOID } from "3d-tiles-renderer";

const DEG=Math.PI/180;
const angle=a=>Math.atan2(Math.sin(a),Math.cos(a));
export function flightPose(plane){return {lat:plane.lat,lon:plane.lon,height:plane.height,heading:plane.heading,pitch:plane.pitch,roll:plane.roll};}

export class LandingSystem {
  constructor(runway){this.runway=runway;this.gear=null;this.beforeFrame=new Matrix4();this.afterFrame=new Matrix4();this.reset();}
  reset(){this.grounded=false;this.status='airborne';this.touchdown=null;this.groundTime=0;this.bounceTime=0;this.reason='';}
  near(plane){const p=this.runway.coordinates(plane);return Math.abs(p.x)<12000&&Math.abs(p.z)<22000;}
  protects(plane){if(!this.gear)return false;const p=this.runway.coordinates(plane);return this.runway.contains(p)&&p.y<35;}
  frame(p,target){WGS84_ELLIPSOID.getObjectFrame(p.lat,p.lon,p.height,p.heading,p.pitch,-p.roll,target,CAMERA_FRAME);return target.premultiply(this.runway.inverse);}
  feet(plane){const m=this.frame(plane,this.afterFrame);return this.gear.points().map(w=>({name:w.name,point:w.point.applyMatrix4(m)}));}
  align(plane){const feet=this.feet(plane),lowest=Math.min(...feet.map(w=>w.point.y)),p=this.runway.coordinates(plane);Object.assign(plane,this.runway.pose(p.x,-p.z,p.y-lowest));}
  failure(plane,reason){this.reason=reason;this.status='crashed';this.grounded=false;return {handled:true,crash:reason};}
  resolve(plane,before,dt){
    if(!this.gear)return {handled:false};
    if(this.bounceTime>0){this.bounceTime-=dt;return {handled:this.protects(plane)};}
    const from=this.runway.coordinates(before),to=this.runway.coordinates(plane);
    if(Math.min(from.y,to.y)>40||(!this.runway.contains(from)&&!this.runway.contains(to)))return {handled:false};
    this.frame(before,this.beforeFrame);this.frame(plane,this.afterFrame);
    const hits=[];
    const contacts=[...this.gear.bodyPoints.map(point=>({name:'body',point})),...(this.gear.extension>=.98?this.gear.points():[])];
    for(const contact of contacts){
      const a=contact.point.clone().applyMatrix4(this.beforeFrame),b=contact.point.clone().applyMatrix4(this.afterFrame);
      if(b.y>.015||b.y>a.y+.01)continue;
      const fraction=a.y<=0?0:Math.min(1,Math.max(0,a.y/(a.y-b.y)));
      const point=a.lerp(b,fraction);
      if(this.runway.contains(point))hits.push({name:contact.name,point,fraction});
    }
    if(!hits.length)return {handled:this.protects(plane)};
    hits.sort((a,b)=>a.fraction-b.fraction);const first=hits[0];
    for(const field of ['lat','lon','height','heading','pitch','roll'])plane[field]=before[field]+(plane[field]-before[field])*first.fraction;
    if(first.name==='body')return this.failure(plane,this.gear.extension<.98?'Gear-up landing':'Fuselage or wing strike');
    if(!this.runway.contains(first.point,{landing:true,margin:1}))return this.failure(plane,'Touchdown outside the landing zone');
    if(first.name==='nose'&&!hits.some(h=>h.name==='main'&&Math.abs(h.fraction-first.fraction)<.04))return this.failure(plane,'Nose wheel first — flare before touchdown');
    const sink=Math.max(0,(from.y-to.y)/dt),yaw=Math.abs(angle(plane.heading-this.runway.definition.heading*DEG));
    if(Math.abs(plane.roll)>7*DEG)return this.failure(plane,'Too much bank at touchdown');
    const surfacePitch = plane.pitch - (this.runway.groundPitch || 0);
    if(surfacePitch<-.8*DEG||surfacePitch>11*DEG)return this.failure(plane,'Unsafe pitch at touchdown');
    if(yaw>12*DEG)return this.failure(plane,'Not aligned with the runway');
    if(plane.speed<this.gear.speed*.68||plane.speed>this.gear.speed*1.4)return this.failure(plane,'Unsafe landing speed');
    if(sink>4.5)return this.failure(plane,'Hard impact — landing gear failed');
    this.align(plane);
    this.touchdown={sink,speed:plane.speed,along:-first.point.z,quality:sink>2.5?'firm':'smooth'};
    if(sink>3.2){plane.verticalSpeed=sink*.4;this.bounceTime=.35;this.status='bounced';return {handled:true};}
    this.grounded=true;plane.verticalSpeed=0;this.status='rollout';this.groundTime=0;this.touchdown.pitch=plane.pitch;
    return {handled:true};
  }
  roll(plane,dt,ctrl){
    this.groundTime+=dt;
    const brake=ctrl.wheelBrake?1:0;
    if(plane.isSailplane){plane.throttle=0;plane.airbrake+=((ctrl.airbrake||0)-plane.airbrake)*(1-Math.exp(-4*dt));}
    else plane.throttle+=(Math.max(0,Math.min(1,ctrl.throttle))-plane.throttle)*(1-Math.exp(-3*dt));
    const resistance=(this.runway.isGrass?.45:.12)+.00025*plane.speed*plane.speed+brake*4.2;
    const towPull=plane.isSailplane?Math.max(0,Math.min(3,ctrl.towAcceleration||0)):0;
    plane.speed=Math.max(0,plane.speed+(plane.throttle*3.8+towPull-resistance)*dt);
    if(plane.speed<.35&&plane.throttle<.04&&!towPull)plane.speed=0;
    const turn=ctrl.roll*.65*(plane.speed/(plane.speed+3))/(1+plane.speed/10);
    if(Math.abs(turn*plane.speed)>6)return this.failure(plane,'Lost directional control');
    plane.heading+=turn*dt;
    plane.roll*=Math.exp(-8*dt);
    const restPitch=this.gear.restPitch+(this.runway.groundPitch||0);
    plane.pitch=restPitch+((this.touchdown?.pitch||0)-restPitch)*Math.exp(-1.8*this.groundTime);
    const p=this.runway.coordinates(plane),delta=angle(plane.heading-this.runway.definition.heading*DEG);
    p.x+=Math.sin(delta)*plane.speed*dt;p.z-=Math.cos(delta)*plane.speed*dt;
    Object.assign(plane,this.runway.pose(p.x,-p.z,p.y));this.align(plane);
    const feet=this.feet(plane);
    if(feet.some(w=>!this.runway.contains(w.point,{margin:.5})))return this.failure(plane,'Runway excursion');
    if(plane.speed>this.gear.speed*1.08&&plane.throttle>.65&&ctrl.pitch>.35&&!brake){
      this.grounded=false;this.status='airborne';plane.verticalSpeed=2.5;plane.pitch=8*DEG;
      // Rotate around the main wheels rather than pushing them through the pavement.
      this.align(plane);this.bounceTime=.6;return {handled:true};
    }
    this.status=plane.speed<.5?'stopped':'rollout';return {handled:true};
  }
  diagnostics(plane){
    const p=this.runway.coordinates(plane),d=this.runway.definition,remaining=d.threshold+p.z;
    const feet=this.gear?this.feet(plane):[];
    const wheelClearance=feet.length?Math.min(...feet.map(w=>w.point.y)):p.y;
    return {status:this.status,grounded:this.grounded,reason:this.reason,runway:d.name,runwayId:d.id,airportId:d.airportId,ident:d.ident,elevation:this.runway.elevation,runwaySlope:this.runway.physical?.slope||0,crossTrackM:p.x,distanceToThresholdM:remaining,runwayRemainingM:d.length+p.z,
      gearDown:this.gear?.extension>=.98,gearExtension:this.gear?.extension??0,sinkMps:-(plane.verticalSpeed||0),speedKmh:plane.speed*3.6,targetKmh:(this.gear?.speed||0)*3.6,
      wheelClearanceM:wheelClearance,glideErrorM:wheelClearance-Math.max(0,remaining+(d.aimingPoint??300))*Math.tan(3*DEG),touchdown:this.touchdown,wheelHeights:feet.map(w=>({name:w.name,height:w.point.y}))};
  }
}
