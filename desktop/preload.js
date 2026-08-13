const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('omnia', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
  },
});
