const { contextBridge } = require('electron');

// The page compiles NEXT_PUBLIC_API_URL in at build time, so it always believes
// the backend is on 8000. When the port search moves it, main.js passes the real
// base as a launch argument and this is where the page reads it — preload runs
// before any page script, so the value is present before the first request.
const apiArg = process.argv.find((a) => a.startsWith('--omnia-api-base='));

contextBridge.exposeInMainWorld('omnia', {
  apiBase: apiArg ? apiArg.slice('--omnia-api-base='.length) : null,
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
  },
});
