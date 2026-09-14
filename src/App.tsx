import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowUpRight,ChevronLeft,RefreshCw,Settings2,X,LoaderCircle,Check, CircleAlert,ShieldQuestion,MessageCircle,Clock3} from 'lucide-react';
import Robot from './Robot';
import {tokenLabel,tokenDescription} from '../core/token-usage.mjs';
import './robot.css';
import {normalizePetScale,petLayoutHeight,PET_WIDTH,PET_SCALE_MIN,PET_SCALE_MAX,PET_SCALE_STEP} from '../core/pet-scale.mjs';
import {deriveMood,statusLabels,statusOrder} from '../core/task-state.mjs';
import {completedTaskRetentionOptions,isTaskVisible,normalizeCompletedTaskRetention} from '../core/task-visibility.mjs';
import type {Mood,Settings,Snapshot,TaskStatus} from './types';
const defaults:Settings={openAtLogin:false,startupAvailable:false,startupStatus:'unavailable',petScale:100,name:'Aster',notifications:false,alwaysOnTop:true,reducedMotion:false,completedTaskRetentionMinutes:-1};
function initialSettings():Settings{try{return {...defaults,petScale:normalizePetScale(JSON.parse(localStorage.getItem('aster.petScale')||'null')),completedTaskRetentionMinutes:normalizeCompletedTaskRetention(JSON.parse(localStorage.getItem('aster.completedTaskRetentionMinutes')||'null'))};}catch{return defaults;}}
const initial:Snapshot={tasks:[],connected:false,error:null,checkedAt:0,sourceLabel:'正在连接本机任务',limit:160};
const labels:Record<TaskStatus,string>={running:'进行中',approval:'待授权',input:'等待输入',waiting:'等待确认',completed:'本轮完成',interrupted:'已中断',failed:'执行失败',unknown:'状态未知',unconfirmed:'待核实',idle:'空闲'};
const needsYou=(s:TaskStatus)=>['approval','input','waiting'].includes(s);
const statusIcons={running:LoaderCircle,completed:Check,failed:CircleAlert,approval:ShieldQuestion,input:MessageCircle,waiting:Clock3};
const timeAgo=(t:number)=>{const s=Math.max(0,(Date.now()-t)/1000);return s<60?'刚刚':s<3600?`${Math.floor(s/60)} 分钟前`:s<86400?`${Math.floor(s/3600)} 小时前`:`${Math.floor(s/86400)} 天前`;};
export default function App(){
  const panel=new URLSearchParams(location.search).get('view')==='tasks';
  const [snapshot,setSnapshot]=useState(initial),[settings,setSettings]=useState(initialSettings),[provider,setProvider]=useState('all'),[filter,setFilter]=useState(new URLSearchParams(location.search).get('filter')||'all'),[page,setPage]=useState(new URLSearchParams(location.search).get('page')==='settings'?'settings':'tasks'),[notice,setNotice]=useState('');
  const [now,setNow]=useState(Date.now);
  const drag=useRef<{x:number;y:number;moved:boolean}|null>(null);
  useEffect(()=>{let alive=true;const receive=(s:Snapshot)=>alive&&setSnapshot(s);let unsub:(()=>void)|undefined;let settingsUnsub:(()=>void)|undefined;let unsubFilter:(()=>void)|undefined;let timer:ReturnType<typeof setInterval>|undefined;
    if(window.aster){settingsUnsub=window.aster.onSettings(s=>alive&&setSettings({...defaults,...s,petScale:normalizePetScale(s.petScale)}));unsubFilter=window.aster.onFilter(f=>{if(f==='settings'){setPage('settings');return;}setFilter(f);setPage('tasks');setProvider('all');});window.aster.snapshot().then(receive);unsub=window.aster.onSnapshot(receive);window.aster.settings().then(s=>alive&&setSettings({...defaults,...s,petScale:normalizePetScale(s.petScale)}));}
    else{const poll=()=>fetch('/api/tasks').then(r=>r.json()).then(receive).catch(()=>{});poll();timer=setInterval(poll,3000);}
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')window.aster?.windowAction('close-list');};window.addEventListener('keydown',key);
    return()=>{alive=false;unsub?.();settingsUnsub?.();unsubFilter?.();clearInterval(timer);window.removeEventListener('keydown',key);};
  },[panel]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(t);},[notice]);
  useEffect(()=>{setNow(Date.now());if(settings.completedTaskRetentionMinutes<=0)return;const timer=setInterval(()=>setNow(Date.now()),3000);return()=>clearInterval(timer);},[settings.completedTaskRetentionMinutes]);
  const visibleTasks=useMemo(()=>snapshot.tasks.filter(t=>isTaskVisible(t,settings.completedTaskRetentionMinutes,now)),[snapshot.tasks,settings.completedTaskRetentionMinutes,now]);
  const counts=Object.fromEntries(statusOrder.map(status=>[status,visibleTasks.filter(t=>t.status===status).length]));
  const visibleIds=new Set(visibleTasks.map(t=>t.id));
  const alerts=(snapshot.alerts||[]).filter(t=>visibleIds.has(t.id));
  const alertStatus=(['approval','failed','input','waiting','completed'] as TaskStatus[]).find(status=>alerts.some(t=>t.status===status));
  const visibleStatuses=statusOrder.filter(status=>!['input','waiting'].includes(status)||counts[status]>0);
  const layoutHeight=petLayoutHeight(visibleStatuses.length,!snapshot.connected||!!alertStatus);
  useEffect(()=>{if(!panel)window.aster?.windowAction(`pet-layout:${layoutHeight}`);},[panel,layoutHeight]);
  const statusSummary=visibleStatuses.filter(status=>counts[status]>0).map(status=>`${statusLabels[status as keyof typeof statusLabels]} ${counts[status]}`).join('，')||'暂无任务';
  const mood=deriveMood(visibleTasks,snapshot.connected) as Mood;
  const tasks=useMemo(()=>visibleTasks.filter(t=>(provider==='all'||t.provider===provider)&&(filter==='all'||(filter==='attention'?needsYou(t.status)||t.status==='failed':t.status===filter))).sort((a,b)=>{const rank=(s:TaskStatus)=>needsYou(s)?0:s==='failed'?1:s==='running'?2:3;return rank(a.status)-rank(b.status)||b.updatedAt-a.updatedAt;}),[visibleTasks,provider,filter]);
  async function update(patch:Partial<Settings>){const next={...settings,...patch};setSettings(next);if(window.aster){try{await window.aster.saveSettings(patch);}catch{setNotice('设置保存失败，请重试');window.aster.settings().then(setSettings).catch(()=>{});}}else try{localStorage.setItem('aster.petScale',JSON.stringify(next.petScale));localStorage.setItem('aster.completedTaskRetentionMinutes',JSON.stringify(next.completedTaskRetentionMinutes));}catch{}}
  function selectFilter(status:string){setFilter(status);window.aster?.windowAction(`read-status:${status}`);}
  function showStatus(status:string){if(window.aster)window.aster.windowAction(`show-list:${status}`);else location.search=`?view=tasks&filter=${status}`;}
  function toggle(){if(window.aster)window.aster.windowAction('toggle-list');else location.search='?view=tasks';}
  if(!panel)return <main style={{width:PET_WIDTH,height:layoutHeight,transform:`scale(${settings.petScale/100})`,transformOrigin:'top left'}} className={`pet ${settings.reducedMotion?'reduced-motion':''}`}>
    <button className="pet-hit" aria-label={`${settings.name}，${statusSummary}；拖动可移动`} title="点击看任务 · 右键打开设置 · 拖动可移动" onContextMenu={e=>{e.preventDefault();if(window.aster)window.aster.windowAction('settings');else location.search='?view=tasks&page=settings';}} onPointerDown={e=>{if(e.button!==0)return;drag.current={x:e.screenX,y:e.screenY,moved:false};e.currentTarget.setPointerCapture(e.pointerId);window.aster?.beginDrag();}} onPointerMove={e=>{const d=drag.current;if(!d)return;const dx=e.screenX-d.x,dy=e.screenY-d.y;if(Math.abs(dx)+Math.abs(dy)>5)d.moved=true;if(d.moved)window.aster?.drag({x:dx,y:dy});}} onPointerUp={()=>{const d=drag.current;drag.current=null;if(d&&!d.moved)toggle();}} onPointerCancel={()=>{drag.current=null;}} onClick={e=>{if(e.detail===0)toggle();}}>
      <Robot mood={mood}/>
    </button>
    <section className="pet-status-dock" aria-label="任务状态">
      <div className="pet-announcement" role="status" aria-live="polite" aria-atomic="true">
        {!snapshot.connected?<span className="connection-note">{snapshot.checkedAt?'连接中断':'连接中…'}</span>:alertStatus?<button className={`status-alert ${alertStatus}`} onClick={()=>showStatus(alertStatus)} aria-label={`${statusLabels[alertStatus as keyof typeof statusLabels]}，${alerts.filter(t=>t.status===alertStatus).length} 项新动态，点击查看`} title={alerts.filter(t=>t.status===alertStatus).map(t=>t.title).join('\n')}><span>{alertStatus==='completed'?'新完成':statusLabels[alertStatus as keyof typeof statusLabels]} {alerts.filter(t=>t.status===alertStatus).length}</span><ArrowUpRight size={12} aria-hidden="true"/></button>:null}
      </div>
      <div className="pet-status-grid">{visibleStatuses.map(status=>{const Icon=statusIcons[status as keyof typeof statusIcons];return <button key={status} className={`status-chip ${status} ${counts[status]?'has-tasks':''} ${alerts.some(t=>t.status===status)?'has-update':''}`} aria-label={`${statusLabels[status as keyof typeof statusLabels]} ${counts[status]} 个任务，点击查看${alerts.some(t=>t.status===status)?'，有新动态':''}`} title={`${statusLabels[status as keyof typeof statusLabels]} ${counts[status]} · 点击查看${status==='completed'?'最新一轮完成的任务':''}`} onClick={()=>showStatus(status)}><Icon size={14} strokeWidth={1.8} aria-hidden="true"/><b>{counts[status]}</b>{alerts.some(t=>t.status===status)&&<em aria-hidden="true"/>}</button>;})}</div>
    </section>
  </main>;
  return <main className="popover">
    <header><div><span className="aster-mark">✳</span><b>{page==='tasks'?'任务动态':'伙伴设置'}</b><span className="live-label"><i className={snapshot.connected?'online':''}/>{snapshot.connected?'本机':'离线'}</span></div><nav><button aria-label="刷新任务" title="刷新" onClick={()=>window.aster?.refresh()}><RefreshCw size={15}/></button><button className="settings-entry" title={page==='tasks'?'打开设置':'返回任务'} aria-label={page==='tasks'?'打开设置':'返回任务'} onClick={()=>setPage(page==='tasks'?'settings':'tasks')}>{page==='tasks'?<><Settings2 size={15}/><span>设置</span></>:<><ChevronLeft size={15}/><span>任务</span></>}</button><button aria-label="收起任务列表" onClick={()=>window.aster?.windowAction('close-list')}><X size={17}/></button></nav></header>
    {page==='tasks'?<><div className="summary status-summary">{visibleStatuses.map(status=><button key={status} className={`summary-status ${status}`} aria-pressed={filter===status} onClick={()=>selectFilter(status)}><b>{counts[status]}</b><span>{statusLabels[status as keyof typeof statusLabels]}</span></button>)}</div>
      <div className="task-toolbar">
        <select id="provider-filter" aria-label="来源筛选" value={provider} onChange={e=>setProvider(e.target.value)}>{[['all','全部工具'],['codex','Codex'],['claude','Claude Code'],['cursor','Cursor'],['kiro','Kiro'],['cli','其他 CLI']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        <div className="list-scope" aria-label="任务范围">{[['all','全部'],['attention','需处理']].map(([id,label])=><button key={id} aria-pressed={filter===id} onClick={()=>selectFilter(id)}>{label}</button>)}</div>
        <span className="task-count">{tasks.length} 项</span>
      </div>
      <div className="task-list" aria-label="本机任务列表">{tasks.map(t=><button key={t.id} className="task-row" title={`${t.evidence}\n${t.jumpTarget?.label||'查看定位方式'}`} onClick={async()=>{if(!window.aster){setNotice('任务跳转请使用桌面版');return;}try{const result=await window.aster.openTask(t.id);setNotice(result.message||'');}catch{setNotice('无法打开任务，请回到对应工具查看');}}}>
        <span className={`task-dot ${t.status}`}/><span className="task-content"><span className="task-top"><b>{t.title}</b><span className={`status ${t.status}`}>{labels[t.status]||'待核实'}</span></span>{t.subtitle&&<span className="task-subtitle" title={t.subtitle}>{t.subtitle}</span>}<span className="task-meta"><span className="task-source" title={`${t.sourceLabel||t.provider||'Codex'} · ${t.project}`}>{t.sourceLabel||t.provider||'Codex'} · {t.project}</span><span className={`task-tokens ${t.tokenUsage?'':'unavailable'}`} title={tokenDescription(t.tokenUsage)}>{tokenLabel(t.tokenUsage)}</span><span className="task-time">{timeAgo(t.updatedAt)}</span></span>{needsYou(t.status)&&<span className="attention-note">{t.status==='approval'?'需要你批准后才能继续':t.status==='input'?'正在等待你的回答':'需要你确认'}</span>}</span><ArrowUpRight size={13} className="jump-icon"/>
      </button>)}{!tasks.length&&<div className="empty">{snapshot.checkedAt?'暂无匹配任务':'正在读取本机任务…'}<small>{snapshot.sources?.find(s=>s.provider===provider)?.error||snapshot.error||(provider==='cli'?'使用 Aster CLI 包装命令启动任务后会显示在这里':'开始任务后会自动出现在这里')}</small></div>}</div>
      <footer><i className={snapshot.connected?'online':''}/><span>每 3 秒同步</span><span>点击任务定位</span></footer></>:<div className="settings">
        <label>伙伴名称<input value={settings.name} maxLength={24} onChange={e=>setSettings({...settings,name:e.target.value})} onBlur={()=>update({name:settings.name.trim()||'Aster'})}/></label>
        <div className="scale-setting">
          <div className="scale-setting-heading"><label htmlFor="pet-scale">桌宠大小</label><output htmlFor="pet-scale">{settings.petScale}%</output><button className="scale-reset" disabled={settings.petScale===100} onClick={()=>update({petScale:100})}>恢复默认</button></div>
          <input id="pet-scale" type="range" min={PET_SCALE_MIN} max={PET_SCALE_MAX} step={PET_SCALE_STEP} value={settings.petScale} aria-valuetext={`${settings.petScale}%`} aria-describedby="pet-scale-note" onChange={e=>update({petScale:normalizePetScale(Number(e.target.value))})}/>
          <div className="scale-range-labels" aria-hidden="true"><span>小 · {PET_SCALE_MIN}%</span><span>大 · {PET_SCALE_MAX}%</span></div>
          <p id="pet-scale-note" className="retention-note">拖动即时调整，自动记住大小。</p>
        </div>
        <label className="check"><span>开机启动</span><input type="checkbox" checked={settings.openAtLogin} disabled={!settings.startupAvailable} onChange={e=>update({openAtLogin:e.target.checked})}/></label>
        <p className="retention-note">{!settings.startupAvailable?'请在桌面应用中设置开机启动。':settings.startupStatus==='requires-approval'?'请在系统设置 → 通用 → 登录项中允许 Aster。':'登录电脑后自动显示桌宠，可随时关闭。'}</p>
        <label className="check"><span>系统通知：完成、失败与待处理</span><input type="checkbox" checked={settings.notifications} onChange={e=>update({notifications:e.target.checked})}/></label>
        <label className="check"><span>减少角色动作</span><input type="checkbox" checked={settings.reducedMotion} onChange={e=>update({reducedMotion:e.target.checked})}/></label>
        <label htmlFor="completed-task-retention">历史任务隐藏时间<select id="completed-task-retention" aria-describedby="completed-task-retention-note" value={settings.completedTaskRetentionMinutes} onChange={e=>update({completedTaskRetentionMinutes:Number(e.target.value)})}>{completedTaskRetentionOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <p id="completed-task-retention-note" className="retention-note">已完成任务按本轮完成时间计时；失败、中断、空闲、状态未知和待核实任务按最后更新时间计时。到期后从列表、数量和提示中隐藏，不删除原任务。进行中、待授权和等待输入／确认的任务继续显示。1 个月按 30 天计算。</p>
        <div className="model-setting"><span>虚拟形象</span><span>小机器人</span></div>
        <p className="settings-note">桌宠始终显示各状态和数量，新完成、失败、待授权、待输入会保留提示，点击对应状态查看后清除；历史任务隐藏时也会隐藏其提示。系统通知可单独开启。「已完成」表示任务最新一轮完成。只有明确的运行事件才标记执行中；历史记录无法确认的状态会标为待核实。不同工具的定位能力以点击后的提示为准。</p>
        <div className="source-list">{snapshot.sources?.map(s=><div key={s.provider} title={s.error||s.sourceLabel}><span>{s.sourceLabel}</span><small>{s.connected?`${s.count} 个任务`:'未发现记录'}</small></div>)}</div><p className="credit">Aster · Inspired by AIRI<br/>Aster Robot</p>
      </div>}
    {notice&&<div className="toast" role="status">{notice}</div>}
  </main>;
}
