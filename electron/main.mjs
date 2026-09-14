import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, screen, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { TaskMonitor } from '../core/monitor.mjs';
import { statusLabels, statusOrder } from '../core/task-state.mjs';
import { openTaskTarget } from '../core/task-jump.mjs';
import { normalizePetScale, scaledPetBounds, PET_WIDTH, PET_HEIGHT, petLayoutHeight } from '../core/pet-scale.mjs';
import { normalizePetPosition, rememberPetPosition, restorePetBounds } from '../core/pet-position.mjs';
import { readLoginStartup, setLoginStartup } from '../core/login-startup.mjs';
import { normalizeCompletedTaskRetention } from '../core/task-visibility.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
app.setName('Aster');app.setPath('userData',join(app.getPath('appData'),'Aster'));
let pet,list,tray,monitor,quitting=false,dragOrigin,layoutHeight=PET_HEIGHT,position=null,positionTimer;
let settings={notifications:false,alwaysOnTop:true,reducedMotion:false,name:'Aster',petScale:100,completedTaskRetentionMinutes:-1};
const positionPath=()=>join(app.getPath('userData'),'window-position.json');
function savePosition(){clearTimeout(positionTimer);if(!pet||pet.isDestroyed())return;position=rememberPetPosition(pet.getBounds(),screen.getDisplayMatching(pet.getBounds()));try{mkdirSync(app.getPath('userData'),{recursive:true});writeFileSync(positionPath(),JSON.stringify(position));}catch{/* Keep the in-memory position when storage is unavailable. */}}
function keepPetVisible(){if(!pet||pet.isDestroyed())return;pet.setBounds(restorePetBounds(screen.getAllDisplays(),screen.getPrimaryDisplay().id,position,pet.getBounds()));savePosition();}
const settingsPath=()=>join(app.getPath('userData'),'settings.json');
function clamp(n,min,max){return Math.max(min,Math.min(n,max));}
function placeList(){const b=pet.getBounds(),a=screen.getDisplayMatching(b).workArea,w=Math.min(340,a.width),h=Math.min(420,a.height);list.setBounds({width:w,height:h,x:clamp(b.x+b.width-200-w+30,a.x,a.x+a.width-w),y:clamp(b.y+b.height-h,a.y,a.y+a.height-h)});}
function showList(filter='all'){if(typeof filter!=='string')filter='all';placeList();list.webContents.send('tasks:filter',filter);list.show();list.focus();monitor?.acknowledge(filter);}
function showSettings(){placeList();list.webContents.send('tasks:filter','settings');list.show();list.focus();}
function applyPetScale(){const bounds=pet.getBounds();pet.setBounds(scaledPetBounds(bounds,screen.getDisplayMatching(bounds).workArea,settings.petScale,layoutHeight));if(list?.isVisible())placeList();}
function showPet(){pet.showInactive();}
function makeWindow(extra){const win=new BrowserWindow({frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,show:false,skipTaskbar:true,webPreferences:{preload:join(root,'electron/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true},...extra});win.setAlwaysOnTop(true,'floating');win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});win.on('page-title-updated',e=>e.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.on('close',e=>{if(!quitting){e.preventDefault();win.hide();}});return win;}
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',()=>{if(pet)showPet();});
  app.whenReady().then(async()=>{
    try{settings={...settings,...JSON.parse(readFileSync(settingsPath(),'utf8'))};}catch{}
    settings.petScale=normalizePetScale(settings.petScale);
    settings.completedTaskRetentionMinutes=normalizeCompletedTaskRetention(settings.completedTaskRetentionMinutes);
    try{position=normalizePetPosition(JSON.parse(readFileSync(positionPath(),'utf8')));}catch{}
    settings={...settings,...readLoginStartup(app)};
    const scale=settings.petScale/100;
    const initialBounds=restorePetBounds(screen.getAllDisplays(),screen.getPrimaryDisplay().id,position,{width:Math.round(PET_WIDTH*scale),height:Math.round(PET_HEIGHT*scale)});
    pet=makeWindow({title:'Aster · 悬浮桌宠',...initialBounds});
    list=makeWindow({title:'Aster · 任务动态',width:340,height:420});
    pet.webContents.session.setPermissionRequestHandler((_w,_p,callback)=>callback(false));
    pet.webContents.session.webRequest.onHeadersReceived((d,cb)=>cb({responseHeaders:{...d.responseHeaders,'Content-Security-Policy':["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'"]}}));
    list.on('blur',()=>list.hide());pet.on('move',()=>{if(list.isVisible())placeList();clearTimeout(positionTimer);positionTimer=setTimeout(savePosition,250);});
    for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,keepPetVisible);
    const icon=nativeImage.createFromPath(join(root,'build/tray.png')).resize({width:18,height:18});icon.setTemplateImage(true);tray=new Tray(icon);tray.setToolTip('Aster · 桌面伙伴');
    tray.setContextMenu(Menu.buildFromTemplate([{label:'显示桌宠',click:showPet},{label:'查看任务',click:showList},{label:'设置…',click:showSettings},{label:'隐藏桌宠',click:()=>{list.hide();pet.hide();}},{type:'separator'},{label:'退出 Aster',click:()=>{quitting=true;app.quit();}}]));
    monitor=new TaskMonitor().start();
    const own=e=>[pet.webContents,list.webContents].includes(e.sender);
    ipcMain.handle('tasks:snapshot',e=>own(e)?monitor.snapshot:null);
    ipcMain.handle('tasks:refresh',e=>{if(own(e))monitor.refresh();return true;});
    ipcMain.handle('tasks:open',async(e,id)=>{if(!own(e)||typeof id!=='string')return {ok:false,message:'任务不可用'};const task=monitor.snapshot.tasks.find(t=>t.id===id);if(!task)return {ok:false,message:'任务已不在列表中，请刷新'};
      if(task.provider==='codex'&&task.observation!=='process'&&/^[0-9a-f-]{36}$/i.test(task.nativeId||task.id)){try{await shell.openExternal(`codex://threads/${task.nativeId||task.id}`);return {ok:true,message:'已打开 Codex 对应任务'};}catch{return {ok:false,message:'Codex 任务打开失败'};}}
      return openTaskTarget(task);
    });
    ipcMain.handle('settings:get',()=>{settings={...settings,...readLoginStartup(app)};return settings;});
    ipcMain.handle('settings:set',(e,input)=>{if(!own(e)||!input||typeof input!=='object')return settings;if('openAtLogin' in input)settings={...settings,...setLoginStartup(app,input.openAtLogin)};for(const k of ['notifications','reducedMotion'])if(typeof input[k]==='boolean')settings[k]=input[k];if('petScale' in input)settings.petScale=normalizePetScale(input.petScale);if('completedTaskRetentionMinutes' in input)settings.completedTaskRetentionMinutes=normalizeCompletedTaskRetention(input.completedTaskRetentionMinutes);if(typeof input.name==='string')settings.name=input.name.trim().slice(0,24)||'Aster';mkdirSync(app.getPath('userData'),{recursive:true});writeFileSync(settingsPath(),JSON.stringify(settings));applyPetScale();for(const win of [pet,list])if(!win.isDestroyed())win.webContents.send('settings:changed',settings);return settings;});
    ipcMain.on('pet:drag-start',e=>{if(e.sender===pet.webContents)dragOrigin=pet.getBounds();});
    ipcMain.on('pet:drag',(e,delta)=>{if(e.sender!==pet.webContents||!dragOrigin||!Number.isFinite(delta?.x)||!Number.isFinite(delta?.y))return;const x=Math.round(dragOrigin.x+delta.x),y=Math.round(dragOrigin.y+delta.y),a=screen.getDisplayNearestPoint({x,y}).workArea;pet.setPosition(clamp(x,a.x,a.x+a.width-pet.getBounds().width),clamp(y,a.y,a.y+a.height-pet.getBounds().height));});
    ipcMain.handle('window:action',(e,action)=>{if(!own(e))return false;if(e.sender===pet.webContents&&typeof action==='string'&&action.startsWith('pet-layout:')){const height=Number(action.slice(11));if([petLayoutHeight(4),petLayoutHeight(4,true),petLayoutHeight(6),petLayoutHeight(6,true)].includes(height)&&height!==layoutHeight){layoutHeight=height;const b=pet.getBounds(),a=screen.getDisplayMatching(b).workArea,next=scaledPetBounds(b,a,settings.petScale,layoutHeight);pet.setBounds({...next,y:clamp(b.y,a.y,a.y+a.height-next.height)});if(list.isVisible())placeList();}return true;}if(action==='settings')showSettings();if(action==='toggle-list'){if(list.isVisible())list.hide();else showList();}if(typeof action==='string'&&action.startsWith('show-list:')){const filter=action.slice(10);if(filter==='all'||statusOrder.includes(filter))showList(filter);}if(typeof action==='string'&&action.startsWith('read-status:')){const filter=action.slice(12);if(filter==='all'||filter==='attention'||statusOrder.includes(filter))monitor.acknowledge(filter);}if(action==='close-list')list.hide();return true;});
    monitor.on('snapshot',snapshot=>{for(const win of [pet,list])if(!win.isDestroyed())win.webContents.send('tasks:changed',snapshot);});
    monitor.on('alerts',tasks=>{if(settings.notifications&&Notification.isSupported())for(const t of tasks){const n=new Notification({title:`Aster · ${statusLabels[t.status]}`,body:t.title});n.on('click',()=>showList(t.status));n.show();}});
    await pet.loadFile(join(root,'dist/index.html'));await list.loadFile(join(root,'dist/index.html'),{query:{view:'tasks'}});showPet();
  });
  app.on('before-quit',()=>{quitting=true;savePosition();monitor?.stop();});app.on('activate',()=>{if(pet)showPet();});
}
