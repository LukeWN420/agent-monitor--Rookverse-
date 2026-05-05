const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let mainWindow;
let tray;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: '♜ Rookverse — Agent Monitor',
    backgroundColor: '#0B1020',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allow localhost connections
    },
    frame: true,
    autoHideMenuBar: true,
    show: false, // Don't show until loaded
  });

  // Wait for the dev server to be ready, then load
  const targetURL = 'http://localhost:3000';
  
  mainWindow.loadURL(targetURL).catch(err => {
    console.error('Failed to load:', err);
    // Show error page
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <html>
      <body style="background:#0B1020;color:#D4A843;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;">
      <h1>♜ Rookverse</h1>
      <p>Could not connect to Agent Monitor on port 3000</p>
      <p>Make sure the dev server is running: <code>npm run dev</code></p>
      <button onclick="location.reload()" style="margin-top:20px;padding:8px 16px;background:#D4A843;color:#0B1020;border:none;cursor:pointer;font-family:monospace;">Retry</button>
      </body>
      </html>
    `)}`);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (tray && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Simple tray icon — 16x16 gold square
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    canvas[i * 4] = 0xD4;     // R
    canvas[i * 4 + 1] = 0xA8; // G
    canvas[i * 4 + 2] = 0x43;  // B
    canvas[i * 4 + 3] = 0xFF;  // A
  }
  const icon = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '♜ Rookverse', enabled: false },
    { type: 'separator' },
    { label: 'Show Dashboard', click: () => { if (mainWindow) mainWindow.show(); } },
    { label: 'Office View', click: () => { 
      if (mainWindow) { mainWindow.show(); mainWindow.loadURL('http://localhost:3200/office'); }
    }},
    { label: 'Reload', click: () => { if (mainWindow) mainWindow.reload(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setToolTip('♜ Rookverse — Agent Monitor');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) mainWindow.show();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Stay in tray on Windows
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}