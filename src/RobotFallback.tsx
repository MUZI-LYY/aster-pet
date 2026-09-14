import {useId,type CSSProperties} from 'react';
import {robotMoods} from '../core/robot-motion.mjs';
import type {Mood} from './types';

export default function Robot({mood}:{mood:Mood}) {
  const id=useId().replace(/:/g,'');
  const {label,color}=robotMoods[mood];
  return <div className={`robot-avatar robot-${mood}`} style={{'--robot-color':color} as CSSProperties}>
    <svg viewBox="0 0 240 260" role="img" aria-label={`小机器人，${label}`}>
      <defs>
        <linearGradient id={`${id}-shell`} x1="0" y1="0" x2=".8" y2="1" gradientUnits="objectBoundingBox"><stop stopColor="#fff"/><stop offset=".55" stopColor="#eff2f5"/><stop offset="1" stopColor="#bcc7d3"/></linearGradient>
        <linearGradient id={`${id}-screen`} x2="0" y2="1"><stop stopColor="#273542"/><stop offset="1" stopColor="#101923"/></linearGradient>
      </defs>
      <ellipse cx="120" cy="243" rx="49" ry="7" fill="#172838" opacity=".12"/>
      <g className="robot-float">
        <path d="M120 42V27" stroke="#a9b5c1" strokeWidth="7" strokeLinecap="round"/>
        <circle className="robot-light" cx="120" cy="23" r="7"/>
        <rect x="37" y="75" width="17" height="34" rx="8" fill="#a8b7c5"/>
        <rect x="186" y="75" width="17" height="34" rx="8" fill="#a8b7c5"/>
        <rect x="105" y="132" width="30" height="24" rx="9" fill="#a8b7c5"/>
        <g className="robot-arm robot-arm-left"><rect x="55" y="157" width="21" height="53" rx="10.5" fill={`url(#${id}-shell)`} stroke="#aebcc9"/></g>
        <g className="robot-arm robot-arm-right"><rect x="164" y="157" width="21" height="53" rx="10.5" fill={`url(#${id}-shell)`} stroke="#aebcc9"/></g>
        <rect x="84" y="209" width="26" height="27" rx="11" fill="#a9b7c5"/>
        <rect x="130" y="209" width="26" height="27" rx="11" fill="#a9b7c5"/>
        <rect x="76" y="147" width="88" height="76" rx="29" fill={`url(#${id}-shell)`} stroke="#b8c4ce"/>
        <rect x="107" y="168" width="26" height="7" rx="3.5" fill="#cad4dc"/>
        <circle className="robot-light" cx="120" cy="193" r="5"/>
        <rect x="47" y="42" width="146" height="103" rx="35" fill={`url(#${id}-shell)`} stroke="#bac6d1"/>
        <path d="M76 51H155" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".9"/>
        <rect x="59" y="58" width="122" height="73" rx="26" fill={`url(#${id}-screen)`}/>
        <g className="robot-eyes">
          <rect x="82" y="80" width="14" height="25" rx="7"/>
          <rect x="144" y="80" width="14" height="25" rx="7"/>
        </g>
        <path className="robot-smile" d="M110 110Q120 118 130 110" fill="none" strokeWidth="3" strokeLinecap="round"/>
      </g>
    </svg>
  </div>;
}
