// Only the packaged Aster app may register itself. Never register Electron's dev runtime.
export function readLoginStartup(app,platform=process.platform) {
  const available=app.isPackaged&&['darwin','win32'].includes(platform);
  if(!available)return {openAtLogin:false,startupAvailable:false,startupStatus:'unavailable'};
  try{const state=app.getLoginItemSettings();return {openAtLogin:Boolean(state.openAtLogin||state.status==='requires-approval'),startupAvailable:true,startupStatus:state.status|| (state.openAtLogin?'enabled':'not-registered')};}
  catch{return {openAtLogin:false,startupAvailable:false,startupStatus:'unavailable'};}
}
export function setLoginStartup(app,enabled,platform=process.platform) {
  if(typeof enabled!=='boolean'||!readLoginStartup(app,platform).startupAvailable)throw Error('Startup unavailable');
  app.setLoginItemSettings({openAtLogin:enabled});
  const result=readLoginStartup(app,platform);
  if(!result.startupAvailable || result.openAtLogin!==enabled)throw Error('Startup setting not applied');
  return result;
}
