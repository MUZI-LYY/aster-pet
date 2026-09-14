// Shared by the 3D robot and its SVG fallback; time values are in seconds.
export const robotMoods = {
  idle: {label:'待命中',color:'#76e4f4'},
  working: {label:'工作中',color:'#64adff'},
  completed: {label:'本轮完成',color:'#70e8a0'},
  failed: {label:'任务失败',color:'#ff7b83'},
  approval: {label:'等待授权',color:'#ffd078'},
  input: {label:'等待输入',color:'#c7a0ff'},
  waiting: {label:'等待确认',color:'#ffa66b'},
  interrupted: {label:'任务已中断',color:'#a9b5ca'},
  uncertain: {label:'任务状态待核实',color:'#a2bcd1'},
  offline: {label:'等待连接',color:'#8296aa'},
};

export function sampleRobotPose(time,mood='idle',reduced=false,enteredAt=0) {
  const t=reduced?0:time,age=Math.max(0,t-enteredAt);
  const pose={y:0,bodyZ:0,headX:0,headY:0,headZ:-.035,leftZ:-.12,rightZ:.12,leftX:0,rightX:0,eyeY:1,eyeZ:0,smileY:1,brightness:1};
  if(!reduced){
    pose.y=.085+.085*Math.sin(t*1.7);
    pose.bodyZ=.055*Math.sin(t*.9);
    pose.headY=.26*Math.sin(t*.6);
    pose.headZ+=.075*Math.sin(t*.85);
    pose.leftZ-=.13*Math.sin(t*1.2);pose.rightZ+=.13*Math.sin(t*1.2);
    const blink=t%4.8;
    pose.eyeY=blink>4.56?Math.max(.1,Math.abs(blink-4.68)/.12):1;
    pose.brightness=.94+.06*Math.sin(t*1.7);
  }
  // Windows keep gestures occasional, with zero velocity at either end.
  const gesture=(period,start,duration)=>{const phase=t%period-start;return !reduced&&phase>0&&phase<duration?Math.sin(Math.PI*phase/duration)**2:0;};
  if(['idle','working','completed'].includes(mood)){
    pose.smileY=1.35;
    if(!reduced){
      // A buoyant two-beat sway, with the head counterbalancing the body.
      pose.y=.095*(1+Math.sin(t*2.6));
      pose.bodyZ=.075*Math.sin(t*1.3);
      pose.headZ=-.035-.09*Math.sin(t*1.3);
      pose.headX=.065*Math.sin(t*2.6+.4);
      pose.leftZ-=.04*Math.sin(t*2.6);pose.rightZ-=.04*Math.sin(t*2.6);
    }
  }
  if(mood==='idle'){
    const hello=gesture(7.5,1,2.8);
    pose.rightZ+=hello*(1.8+.35*Math.sin(t*9));
    pose.headZ-=hello*.1;pose.eyeY*=1-hello*.2;
  }else if(mood==='working'){
    pose.headX=.08+(reduced?0:.14*Math.sin(t*3.6));pose.headY=reduced?0:.22*Math.sin(t*1.2);
    pose.leftX=-.45+(reduced?0:.6*Math.sin(t*4.8));pose.rightX=-.45+(reduced?0:.6*Math.sin(t*4.8+Math.PI));
    const hello=gesture(8,4,2.2);
    pose.rightZ+=hello*(1.65+.3*Math.sin(t*10));pose.rightX*=1-hello;
    pose.headZ-=hello*.1;pose.eyeY*=1-hello*.18;
    pose.brightness=reduced?1:.87+.13*Math.sin(t*3);
  }else if(mood==='completed'){
    const cheer=!reduced&&age<2.8?Math.sin(Math.PI*age/2.8)**2:0;
    pose.y+=cheer*.22*Math.abs(Math.sin(age*7));pose.leftZ-=cheer*(2.15+.16*Math.sin(age*10));pose.rightZ+=cheer*(2.15-.16*Math.sin(age*10));
    pose.headZ=reduced?-.035:.14*Math.sin(t*1.3);pose.eyeY*=.75;pose.smileY=1.5;
  }else if(mood==='failed'){
    pose.headX=.13;pose.headY=gesture(5,0,2.8)*.44*Math.sin(t*6);pose.eyeZ=.18;pose.smileY=-1;
    pose.leftZ=-.32;pose.rightZ=.32;pose.brightness=reduced?1:.88+.12*Math.sin(t*2);
  }else if(mood==='approval'){
    pose.rightZ=1.55+(reduced?0:gesture(4.5,.5,3)*.52*Math.sin(t*6));pose.headZ=-.08;
  }else if(mood==='input'){
    pose.headZ=-.16;pose.headY=reduced?0:.24*Math.sin(t*.8);pose.rightZ=.72;pose.rightX=-.65;
    pose.headX=reduced?0:gesture(4,.5,2)*.3;
  }else if(mood==='waiting'){
    pose.leftZ=-.75;pose.rightZ=.75;pose.leftX=pose.rightX=-.25;
    pose.headY=reduced?0:.38*Math.sin(t*.85);pose.headZ=.07;
  }else if(mood==='interrupted'){
    pose.headX=.18+(reduced?0:.1*Math.sin(t*1.2));pose.eyeY*=.65;pose.leftZ=-.08;pose.rightZ=.08;
  }else if(mood==='uncertain'){
    pose.headZ=.18+(reduced?0:.16*Math.sin(t*.7));pose.headY=reduced?0:.34*Math.sin(t*.5);
    pose.rightZ=.5;pose.smileY=.3;
  }else if(mood==='offline'){
    pose.headX=.24;pose.eyeY*=.45;pose.y*=.5;pose.bodyZ=0;pose.headY=0;pose.headZ=0;pose.smileY=.3;pose.brightness=.65;
  }
  return pose;
}
