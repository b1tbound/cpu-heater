const { app, BrowserWindow, globalShortcut, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow = null;
let pythonProcess = null;
const SERVER_PORT = 8080;

function startBackend() {
  const isWin = process.platform === 'win32';
  const pyCmd = isWin ? 'python' : 'python3';
  const mainScript = path.join(__dirname, 'main.py');

  pythonProcess = spawn(pyCmd, [mainScript, '--no-browser', '--port', String(SERVER_PORT)], {
    cwd: __dirname,
    stdio: 'ignore',
    windowsHide: true,
  });

  pythonProcess.on('error', (err) => {
    console.error('Failed to spawn Python backend:', err);
  });
}

function waitForServer(retries = 30, delayMs = 300) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${SERVER_PORT}/api/detect`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else if (--retries > 0) {
          setTimeout(check, delayMs);
        } else {
          reject(new Error('Backend server did not respond with 200'));
        }
      });
      req.on('error', () => {
        if (--retries > 0) {
          setTimeout(check, delayMs);
        } else {
          reject(new Error('Backend server timeout'));
        }
      });
      req.setTimeout(500, () => req.destroy());
    };
    check();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    kiosk: true,             // Kiosk mode locks full screen on Linux and Windows
    alwaysOnTop: false,
    autoHideMenuBar: true,
    frame: false,            // Borderless fullscreen locked
    backgroundColor: '#080c14',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true,
    },
    icon: path.join(__dirname, 'assets', 'icon.svg'),
  });

  // Lock fullscreen: ignore or suppress attempts to exit fullscreen unless quit
  mainWindow.setFullScreen(true);
  mainWindow.setKiosk(true);

  mainWindow.on('leave-full-screen', () => {
    // Re-lock fullscreen
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(true);
      mainWindow.setKiosk(true);
    }
  });

  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isFullScreen()) mainWindow.setFullScreen(true);
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    startBackend();
    try {
      await waitForServer();
    } catch (err) {
      console.warn('Proceeding to load window:', err);
    }
    createWindow();

    // Register Escape key emergency exit dialog
    globalShortcut.register('CommandOrControl+Shift+Q', () => {
      app.quit();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (pythonProcess) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(pythonProcess.pid), '/f', '/t']);
        } else {
          pythonProcess.kill('SIGTERM');
        }
      } catch (e) {}
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
