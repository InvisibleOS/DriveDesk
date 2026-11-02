// What the desk's pages may ask the app (window.desk): update status, check, install, show the data folder
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  ask: what => ipcRenderer.invoke('desk', what),
  onUpdate: f => { const h = (_, u) => f(u); ipcRenderer.on('update', h); return () => ipcRenderer.off('update', h) },
});
