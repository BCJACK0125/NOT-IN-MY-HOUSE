import { App } from './core/App.js';
import { LoadingScreen } from './ui/LoadingScreen.js';
import { settings } from './config/settings.js';

const canvas = document.getElementById('viewport');

async function boot() {
  try {
    const app = new App(canvas);
    window.app = app;
    window.settings = settings;
    await app.load();
    window.__ready = true;
  } catch (error) {
    console.error('[boot] failed to start', error);
    new LoadingScreen().fail(error?.message ? `啟動失敗：${error.message}` : '啟動失敗，請看主控台。');
  }
}

boot();
