import { Box3, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";

export const LANDING_SPEEDS = Object.freeze({ pa28:38,q400:58,citation:60,b738:72,a320:70,jet:80 });

export function attachLandingGear(wrapper, model, key) {
  if(!LANDING_SPEEDS[key])return null;
  const box=new Box3().setFromObject(model), size=box.getSize(new Vector3());
  const existing=[];
  if(key==='pa28')model.traverse(node=>{if(/^roue[ADG]$/.test(node.name)){const b=new Box3().setFromObject(node),c=b.getCenter(new Vector3());existing.push({name:node.name,point:new Vector3(c.x,b.min.y,c.z)});}});
  const root=new Group();root.name='landing-gear';wrapper.add(root);
  const rubber=new MeshStandardMaterial({color:0x15181b,roughness:.94});rubber.name='landing-rubber';
  const metal=new MeshStandardMaterial({color:0xafb9c0,metalness:.7,roughness:.3});metal.name='landing-metal';
  const fixed=existing.length===3;
  const radius=(key==='b738'||key==='a320') ? .55 : Math.max(.18,size.z*.022);
  const legLength=Math.max(.7,size.y*.15), bottom=box.min.y-legLength-radius;
  const wheels=fixed?existing.map(w=>({name:w.name==='roueA'?'nose':'main',base:w.point,meshes:[]})):
    [{name:'main',base:new Vector3(-size.x*.115,bottom,size.z*.06),meshes:[]},{name:'main',base:new Vector3(size.x*.115,bottom,size.z*.06),meshes:[]},{name:'nose',base:new Vector3(0,bottom,-size.z*.34),meshes:[]}];
  for(const wheel of wheels)if(!fixed){
    const leg=new Mesh(new CylinderGeometry(.075,.075,legLength,8),metal);leg.position.set(wheel.base.x,box.min.y-legLength/2,wheel.base.z);root.add(leg);wheel.leg=leg;
    for(const side of (size.z>12?[-1,1]:[0])){
      const tire=new Mesh(new CylinderGeometry(radius,radius,radius*.55,14),rubber);tire.rotation.z=Math.PI/2;tire.position.set(wheel.base.x+side*radius*.4,wheel.base.y+radius,wheel.base.z);tire.castShadow=true;root.add(tire);wheel.meshes.push(tire);
      const hub=new Mesh(new CylinderGeometry(radius*.45,radius*.45,radius*.57,10),metal);hub.rotation.z=Math.PI/2;hub.position.copy(tire.position);root.add(hub);wheel.meshes.push(hub);
    }
  }
  const main=wheels.filter(w=>w.name==='main'),nose=wheels.find(w=>w.name==='nose');
  const mainY=main.reduce((sum,w)=>sum+w.base.y,0)/main.length,mainZ=main.reduce((sum,w)=>sum+w.base.z,0)/main.length;
  const restPitch=Math.atan((nose.base.y-mainY)/(nose.base.z-mainZ));
  const rig={root,wheels,fixed,restPitch,extension:1,target:1,compression:0,rotation:0,speed:LANDING_SPEEDS[key],
    bodyPoints:[new Vector3(0,fixed?Math.max(...wheels.map(w=>w.base.y))+.6:box.min.y,0),new Vector3(0,box.min.y+size.y*.2,box.min.z*.9),new Vector3(0,box.min.y+size.y*.3,box.max.z*.9),new Vector3(size.x*.48,box.min.y+size.y*.3,0),new Vector3(-size.x*.48,box.min.y+size.y*.3,0)],
    points(){return wheels.map(w=>({name:w.name,point:w.base.clone().add(new Vector3(0,this.compression,0))}));},
    toggle(grounded){if(!fixed&&!grounded)this.target=1-this.target;},
    reset(){this.extension=this.target=1;this.compression=this.rotation=0;},
    update(dt,speed,grounded,sink=0){
      this.extension+=Math.sign(this.target-this.extension)*Math.min(Math.abs(this.target-this.extension),dt/3);
      this.compression+=((grounded&&!fixed?Math.min(.28,.07+Math.abs(sink)*.03):0)-this.compression)*(1-Math.exp(-8*dt));
      if(grounded)this.rotation+=speed*dt/radius;
      root.visible=this.extension>.02;
      for(const wheel of wheels)if(!fixed){
        for(const mesh of wheel.meshes){mesh.position.y=wheel.base.y+radius+this.compression+(1-this.extension)*(legLength+radius*2);mesh.rotation.x=this.rotation;mesh.scale.setScalar(Math.max(.02,this.extension));}
        wheel.leg.scale.y=Math.max(.01,this.extension*(1-this.compression/legLength));wheel.leg.position.y=box.min.y-(legLength-this.compression)*this.extension/2;
      }
    },
    dispose(){root.removeFromParent();const all=new Set([rubber,metal]);root.traverse(o=>{if(o.geometry)all.add(o.geometry);});for(const r of all)r.dispose();},
  };
  wrapper.userData.landingGear=rig;return rig;
}
