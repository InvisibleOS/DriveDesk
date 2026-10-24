// DriveDesk desktop app: runs the desk's own server in the background and shows it in an app window.
// Closing the window quits the app and stops the server; if the server ever dies it is started again.
import { app, BrowserWindow, dialog, ipcMain, net, powerSaveBlocker, shell, utilityProcess } from 'electron';
import updater from 'electron-updater';
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

// fixed address, so each install keeps its theme and PIN (the browser stores them per address)
const PORT = 47321, DESK = `http://127.0.0.1:${PORT}`;
// the self-contained Next.js server from `npm run desktop:server`; packaged builds carry it in Resources/server
const dir = app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(import.meta.dirname, '../.next-desktop/standalone');
app.setName('DriveDesk'); // same data folder whether run from the code (npm run desktop) or installed
// drives live with the user's app data (~/Library/Application Support/DriveDesk/data on a Mac), never inside the app
const data = path.join(app.getPath('userData'), 'data');
// it used to be called Drive Desk: bring that data folder over once (every drive and the sign-in), as long as
// nothing has been saved under the new name yet (Electron makes the new folder itself before this runs)
const before = path.join(app.getPath('appData'), 'Drive Desk', 'data');
const drivesIn = d => { try { return fs.readdirSync(path.join(d, 'drives')).some(f => f.endsWith('.json')) } catch { return false } };
if (fs.existsSync(before) && !drivesIn(data)) { fs.rmSync(data, { recursive: true, force: true }); fs.renameSync(before, data) }
const logFile = path.join(data, 'server.log');
let server, win, quitting = false;

if (!app.requestSingleInstanceLock()) app.quit(); // opening it twice just brings the window forward
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } });

function start() {
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  server = utilityProcess.fork(path.join(dir, 'server.js'), [], {
    cwd: dir, stdio: 'pipe', serviceName: 'DriveDesk server',
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), HOSTNAME: '127.0.0.1', DATA_DIR: data },
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  server.on('exit', () => { if (!quitting) setTimeout(start, 1000) }); // crashed: bring it back, open pages reconnect
}

const up = () => fetch(DESK).then(() => true, () => false);
async function ready() {
  for (let i = 0; i < 150; i++) {
    if (await up()) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

// Updates: the newest GitHub release (.github/workflows/release.yml builds them). The pages ask for them through
// electron/preload.cjs and show them under ⋯ › About & updates; nothing installs until someone clicks Update.
// Windows installs them with electron-updater. A Mac app without Apple's paid signature can't use Apple's updater,
// so there the new app is downloaded, checked against its checksum and swapped in for this one while DriveDesk restarts.
// DESK_FEED points it at a local folder instead, to try an update before releasing it.
const FEED = process.env.DESK_FEED || 'https://github.com/InvisibleOS/DriveDesk/releases/latest/download';
const { autoUpdater } = updater;
let news = { state: 'idle', data }, found = null; // what the pages are told; the newer version's details
const tell = patch => { news = { ...news, ...patch }; win?.webContents.send('update', news) };
const say = message => Object.assign(Error(message), { say: true }); // an error worth showing as it is
const NO_NET = 'Couldn’t reach the update server. Check the internet connection and try again.';

async function check() {
  if (['checking', 'downloading', 'installing'].includes(news.state)) return news;
  tell({ state: 'checking' });
  try {
    const r = app.isPackaged ? await autoUpdater.checkForUpdates() : null; // the code itself updates with git
    found = r?.isUpdateAvailable ? r.updateInfo : null;
    const notes = found?.releaseNotes;
    tell({ state: found ? 'available' : 'latest', checked: Date.now(), error: undefined,
      next: found ? { version: found.version, date: found.releaseDate, notes: typeof notes === 'string' ? notes.trim() : '' } : undefined });
  } catch { tell({ state: 'error', checked: Date.now(), error: NO_NET }) }
  return news;
}

async function install() {
  if (!found || ['downloading', 'installing'].includes(news.state)) return news;
  tell({ state: 'downloading', progress: 0, error: undefined });
  try {
    if (process.platform === 'darwin') await swapMac(found);
    else {
      await autoUpdater.downloadUpdate();
      tell({ state: 'installing' });
      autoUpdater.quitAndInstall(true, true); // installs without asking, then opens DriveDesk again
    }
  } catch (e) { tell({ state: 'error', error: e.say ? e.message : 'The update didn’t finish downloading. Check the internet connection and try again.' }) }
  return news;
}

async function swapMac(info) {
  // it replaces itself, so it has to run from a folder it can write to: not the disk image, and not the read-only copy
  // macOS runs when the app is opened straight from Downloads
  const bundle = path.resolve(process.execPath, '../../..');
  const writable = () => { try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); return true } catch { return false } };
  if (!bundle.endsWith('.app') || /^\/Volumes\/|AppTranslocation/.test(bundle) || !writable())
    throw say('Move DriveDesk into your Applications folder, open it from there, then try again.');
  const f = info.files.find(f => f.url.endsWith('.zip'));
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'drivedesk-update-')), zip = path.join(tmp, 'update.zip');
  const res = await net.fetch(new URL(f.url, `${FEED}/`).href);
  if (!res.ok) throw Error(`download: ${res.status}`);
  const out = fs.createWriteStream(zip), sha = crypto.createHash('sha512'), total = f.size || Number(res.headers.get('content-length'));
  let got = 0, shown = 0;
  for await (const chunk of res.body) {
    sha.update(chunk);
    if (!out.write(chunk)) await once(out, 'drain');
    got += chunk.length;
    if (got / total - shown >= .01) tell({ progress: shown = got / total });
  }
  out.end();
  await once(out, 'finish');
  if (sha.digest('base64') !== f.sha512) throw say('The download was damaged on the way. Try again.');
  tell({ state: 'installing' });
  await promisify(execFile)('ditto', ['-x', '-k', zip, tmp]);
  const fresh = fs.readdirSync(tmp).find(n => n.endsWith('.app'));
  if (!fresh) throw say('The download was damaged on the way. Try again.');
  // once DriveDesk has quit: the new app goes where this one was (this one comes back if that fails), then it opens
  spawn('/bin/sh', ['-c', `while kill -0 "$1" 2>/dev/null; do sleep .2; done
mv "$2" "$4/old.app" && { mv "$3" "$2" || mv "$4/old.app" "$2"; }
xattr -dr com.apple.quarantine "$2" 2>/dev/null; open "$2"; rm -rf "\${4:?}"`,
  'update', String(process.pid), bundle, path.join(tmp, fresh), tmp], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

app.whenReady().then(async () => {
  fs.mkdirSync(data, { recursive: true });
  if (await up()) {
    dialog.showErrorBox('DriveDesk is already running', `Something else is using ${DESK}. Close it and open DriveDesk again.`);
    return app.quit();
  }
  start();
  if (!await ready()) {
    dialog.showErrorBox("DriveDesk couldn't start", `The details are in ${logFile}`);
    return app.quit();
  }
  powerSaveBlocker.start('prevent-app-suspension'); // the laptop doesn't idle-sleep in the middle of a drive
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, show: false, title: 'DriveDesk', backgroundColor: '#f5f4f0',
    autoHideMenuBar: true, // Windows: no File/Edit/View bar over the desk (Alt shows it)
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show() });
  // the desk never opens other windows; anything outside it goes to the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (!url.startsWith(DESK)) shell.openExternal(url); return { action: 'deny' } });
  win.loadURL(DESK);

  autoUpdater.setFeedURL({ provider: 'generic', url: FEED });
  Object.assign(autoUpdater, { autoDownload: false, autoInstallOnAppQuit: false, disableDifferentialDownload: true });
  autoUpdater.on('download-progress', p => tell({ progress: p.percent / 100 }));
  ipcMain.handle('desk', (_, what) => what === 'check' ? check() : what === 'install' ? install()
    : what === 'data' ? shell.openPath(data).then(() => news) : news);
  setTimeout(check, 5000);
  setInterval(check, 6 * 3600e3);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; server?.kill() });
