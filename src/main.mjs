import { start } from './app.mjs';

const base = new URL('./', document.baseURI).href;
try {
  start(document.getElementById('rw-root'), base);
} catch (err) {
  console.error(err);
  const boot = document.getElementById('rw-boot');
  if (boot) boot.textContent = 'RunwayLab could not start in this browser. Try a recent version of Chrome.';
}
