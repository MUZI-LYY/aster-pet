const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aster', {
  openTask: id => ipcRenderer.invoke('tasks:open',id),
  beginDrag: () => ipcRenderer.send('pet:drag-start'),
  drag: delta => ipcRenderer.send('pet:drag',delta),
  snapshot: () => ipcRenderer.invoke('tasks:snapshot'),
  refresh: () => ipcRenderer.invoke('tasks:refresh'),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: value => ipcRenderer.invoke('settings:set',value),
  windowAction: action => ipcRenderer.invoke('window:action',action),
  onSnapshot: callback => { const h=(_e,s)=>callback(s);ipcRenderer.on('tasks:changed',h);return ()=>ipcRenderer.removeListener('tasks:changed',h); },
  onFilter: callback => { const h=(_e,s)=>callback(s);ipcRenderer.on('tasks:filter',h);return ()=>ipcRenderer.removeListener('tasks:filter',h); },
  onSettings: callback => { const h=(_e,s)=>callback(s);ipcRenderer.on('settings:changed',h);return ()=>ipcRenderer.removeListener('settings:changed',h); },
});
