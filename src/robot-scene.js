import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {robotMoods,sampleRobotPose} from '../core/robot-motion.mjs';

// Built locally, with no model or texture downloads.
export function createRobotScene() {
  const scene=new THREE.Scene(),robot=new THREE.Group();robot.name='robot';scene.add(robot);
  const shell=new THREE.MeshPhysicalMaterial({color:0xeaf0f7,roughness:.27,metalness:.12,clearcoat:.8,clearcoatRoughness:.18});
  const joint=new THREE.MeshStandardMaterial({color:0x728698,metalness:.72,roughness:.3});
  const bezel=new THREE.MeshStandardMaterial({color:0x455666,metalness:.55,roughness:.28});
  const glass=new THREE.MeshPhysicalMaterial({color:0x07131e,metalness:.12,roughness:.19,clearcoat:1,clearcoatRoughness:.12});
  const glow=new THREE.MeshBasicMaterial({color:0x76e4f4,toneMapped:false});
  function box(parent,w,h,d,r,material,x,y,z){const m=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,5,r),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function panel(parent,w,h,d,r,material,x,y,z){
    const a=-w/2,b=-h/2,shape=new THREE.Shape();shape.moveTo(a+r,b);shape.lineTo(a+w-r,b);shape.quadraticCurveTo(a+w,b,a+w,b+r);shape.lineTo(a+w,b+h-r);shape.quadraticCurveTo(a+w,b+h,a+w-r,b+h);shape.lineTo(a+r,b+h);shape.quadraticCurveTo(a,b+h,a,b+h-r);shape.lineTo(a,b+r);shape.quadraticCurveTo(a,b,a+r,b);
    const m=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:d,bevelEnabled:true,bevelThickness:.008,bevelSize:.008,bevelSegments:3,steps:1,curveSegments:16}),material);m.position.set(x,y,z-d/2);m.castShadow=true;parent.add(m);return m;
  }
  function sphere(parent,r,material,x,y,z){const m=new THREE.Mesh(new THREE.SphereGeometry(r,24,16),material);m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m;}
  for(const x of [-.36,.36]){box(robot,.46,.3,.65,.12,shell,x,.2,.09);box(robot,.22,.28,.25,.07,joint,x,.43,0);}
  box(robot,1.18,1.02,.79,.32,shell,0,1.02,0);
  box(robot,.32,.23,.35,.07,joint,0,1.6,0);
  box(robot,.34,.075,.035,.025,joint,0,1.23,.404);
  const chest=sphere(robot,.065,glow,0,.91,.41);chest.scale.z=.4;
  const arms=[];
  for(const x of [-1,1]){sphere(robot,.15,joint,x*.7,1.24,0);const arm=new THREE.Group();arm.name=x<0?'left-arm':'right-arm';arm.position.set(x*.84,1.26,0);robot.add(arm);box(arm,.29,.7,.36,.14,shell,0,-.25,0);arm.rotation.z=x*.12;arms.push(arm);}
  const head=new THREE.Group();head.name='head';head.position.set(0,2.27,0);head.rotation.z=-.035;robot.add(head);
  box(head,2.02,1.43,1.12,.37,shell,0,0,0);
  for(const x of [-1,1]){box(head,.21,.46,.52,.1,joint,x*1.025,-.02,0);box(head,.1,.31,.36,.045,shell,x*1.15,-.02,0);}
  panel(head,1.79,1.11,.13,.29,bezel,0,-.015,.555);
  panel(head,1.67,1,.14,.265,glass,0,-.015,.624);
  const eyes=[];
  for(const x of [-.43,.43])eyes.push(panel(head,.18,.34,.045,.089,glow,x,.02,.707));
  const smile=new THREE.CatmullRomCurve3([new THREE.Vector3(-.14,-.255,.712),new THREE.Vector3(0,-.305,.717),new THREE.Vector3(.14,-.255,.712)]);
  const mouth=new THREE.Group();mouth.position.y=-.28;head.add(mouth);
  const mouthLine=new THREE.Mesh(new THREE.TubeGeometry(smile,24,.018,8,false),glow);mouthLine.position.y=.28;mouth.add(mouthLine);
  box(head,.055,.28,.055,.022,joint,0,.84,0);sphere(head,.105,glow,0,1.02,0);
  scene.add(new THREE.HemisphereLight(0xe8f5ff,0x758392,2.15));
  const key=new THREE.DirectionalLight(0xfff5e5,4.2);key.position.set(-3,6,5);key.castShadow=true;
  key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-3,right:3,top:4,bottom:-3,near:.1,far:16});key.shadow.normalBias=.035;key.shadow.bias=-.0001;key.shadow.radius=4;scene.add(key);
  const rim=new THREE.DirectionalLight(0xc6e7ff,3.5);rim.position.set(3,3,-4);scene.add(rim);
  const fill=new THREE.DirectionalLight(0xffffff,.75);fill.position.set(2,1,5);scene.add(fill);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.ShadowMaterial({opacity:.16}));floor.rotation.x=-Math.PI/2;floor.position.y=.025;floor.receiveShadow=true;scene.add(floor);
  const camera=new THREE.OrthographicCamera(-2,2,2,-2,.1,40);camera.position.set(3.3,2.8,8);camera.lookAt(0,1.8,0);
  function resize(w,h){const aspect=w/h,span=Math.max(4.05,3.25/aspect);camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();}
  let previousMood,lastTime,enteredAt=0,currentPose;
  const targetColor=new THREE.Color();
  function update(time,mood,reduced){
    if(!Object.hasOwn(robotMoods,mood))mood='idle';
    const first=lastTime===undefined;
    if(mood!==previousMood){enteredAt=time;previousMood=mood;}
    const dt=first?0:Math.max(0,Math.min(time-lastTime,.25));lastTime=time;
    const pose=sampleRobotPose(time,mood,reduced,enteredAt);
    // About 200 ms of easing prevents limbs and face colours snapping on status changes.
    const blend=reduced||first?1:1-Math.exp(-dt*12);
    if(!currentPose)currentPose={...pose};
    for(const key of Object.keys(pose))currentPose[key]=THREE.MathUtils.lerp(currentPose[key],pose[key],blend);
    robot.position.y=currentPose.y;robot.rotation.z=currentPose.bodyZ;
    head.rotation.set(currentPose.headX,currentPose.headY,currentPose.headZ);
    arms[0].rotation.set(currentPose.leftX,0,currentPose.leftZ);arms[1].rotation.set(currentPose.rightX,0,currentPose.rightZ);
    eyes.forEach((eye,i)=>{eye.scale.y=pose.eyeY;eye.rotation.z=(i?1:-1)*currentPose.eyeZ;});
    mouth.scale.y=currentPose.smileY;
    targetColor.set(robotMoods[mood].color).multiplyScalar(currentPose.brightness);glow.color.lerp(targetColor,blend);
  }
  function dispose(){const geometries=new Set(),materials=new Set();scene.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of [].concat(o.material))materials.add(m);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());key.shadow.dispose();}
  return {scene,camera,resize,update,dispose};
}
