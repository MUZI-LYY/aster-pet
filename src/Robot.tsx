import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {createRobotScene} from './robot-scene.js';
import {robotMoods} from '../core/robot-motion.mjs';
import RobotFallback from './RobotFallback';
import type {Mood} from './types';

export default function Robot({mood}:{mood:Mood}) {
  const host=useRef<HTMLDivElement>(null),currentMood=useRef(mood);
  const [ready,setReady]=useState(false);currentMood.current=mood;
  useEffect(()=>{
    const el=host.current!;let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}catch{return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
    renderer.domElement.setAttribute('aria-hidden','true');el.appendChild(renderer.domElement);
    const model=createRobotScene(),media=matchMedia('(prefers-reduced-motion: reduce)');
    let frame=0,last=0,time=0,lost=false;
    const reduced=()=>media.matches||Boolean(el.closest('.reduced-motion'));
    const render=()=>{model.update(time,currentMood.current,reduced());renderer.render(model.scene,model.camera);};
    const resize=()=>{const w=el.clientWidth,h=el.clientHeight;if(w&&h){renderer.setSize(w,h);model.resize(w,h);render();}};
    const observer=new ResizeObserver(resize);observer.observe(el);resize();setReady(true);
    const contextLost=(e:Event)=>{e.preventDefault();lost=true;setReady(false);};
    const contextRestored=()=>{lost=false;resize();setReady(true);};
    renderer.domElement.addEventListener('webglcontextlost',contextLost);renderer.domElement.addEventListener('webglcontextrestored',contextRestored);
    function animate(now:number){frame=requestAnimationFrame(animate);if(document.hidden||lost)return;if(now-last<(reduced()?250:1000/30))return;time+=Math.min((now-last)/1000,.08);last=now;render();}
    frame=requestAnimationFrame(animate);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();renderer.domElement.removeEventListener('webglcontextlost',contextLost);renderer.domElement.removeEventListener('webglcontextrestored',contextRestored);model.dispose();renderer.dispose();renderer.domElement.remove();};
  },[]);
  const label=robotMoods[mood].label;
  return <div ref={host} className={`robot-avatar robot-3d ${ready?'is-ready':''}`} role="img" aria-label={`3D 小机器人，${label}`}><div className="robot-fallback" aria-hidden="true"><RobotFallback mood={mood}/></div></div>;
}
