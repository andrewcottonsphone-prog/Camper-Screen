/* Camper Screen - iPhone web controller (Bluefy / Web Bluetooth)
 *
 * Talks to the already-flashed Camper Screen BLE firmware:
 *   service        6a1d0001-1a2b-4c3d-9e4f-5a6b7c8d9e0f
 *   write char     6a1d0002-1a2b-4c3d-9e4f-5a6b7c8d9e0f
 *   UP   press  B0:D   release B0:U
 *   DOWN press  B1:D   release B1:U
 *
 * The firmware keeps moving from Bx:D until the matching Bx:U arrives, so this
 * UI is careful to always send the release command:
 *   pointerup / pointercancel / pointerleave / pointerout, window blur,
 *   page hidden, and any unexpected disconnect all stop the screen.
 */

const SERVICE_UUID = '6a1d0001-1a2b-4c3d-9e4f-5a6b7c8d9e0f';
const WRITE_UUID   = '6a1d0002-1a2b-4c3d-9e4f-5a6b7c8d9e0f';

const CMD = {
  upStart:   'B0:D',
  upStop:    'B0:U',
  downStart: 'B1:D',
  downStop:  'B1:U'
};

const btnUp    = document.getElementById('btn-up');
const btnDown  = document.getElementById('btn-down');
const pill     = document.getElementById('connect');

const encoder = new TextEncoder();

let device         = null;
let characteristic = null;
let connected      = false;
let connecting     = null;      /* in-flight connect promise */
let held           = null;      /* 'up' | 'down' | null      */

/* ------------------------------------------------------------------ status */

function setPill(text, hidden) {
  pill.textContent = text;
  pill.classList.toggle('hidden', !!hidden);
}

/* -------------------------------------------------------------- bluetooth */

function writeChunk(text) {
  return new Promise((resolve) => {
    if (!characteristic || !connected) {
      resolve(false);
      return;
    }
    const data = encoder.encode(text);
    try {
      /* write-without-response is preferred: lowest latency, no queueing */
      if (typeof characteristic.writeValueWithoutResponse === 'function') {
        characteristic.writeValueWithoutResponse(data).then(() => resolve(true), () => resolve(false));
      } else {
        characteristic.writeValue(data).then(() => resolve(true), () => resolve(false));
      }
    } catch (e) {
      resolve(false);
    }
  });
}

function stopEverything() {
  return writeChunk(CMD.upStop).then(() => writeChunk(CMD.downStop));
}

function onDisconnected() {
  connected = false;
  characteristic = null;
  held = null;
  btnUp.classList.remove('held');
  btnDown.classList.remove('held');
  setPill('Tap to connect', false);
}

async function connect() {
  if (connected) {
    return true;
  }
  if (connecting) {
    return connecting;
  }

  if (!navigator.bluetooth) {
    setPill('Open this page in Bluefy', false);
    return false;
  }

  connecting = (async () => {
    try {
      /* must run inside the user gesture: no await before requestDevice().
       * iOS/Bluefy cannot filter-scan for this ESP32's custom 128-bit service
       * UUID, which made the picker come back empty. Open the picker for all
       * nearby BLE devices instead - the Camper Screen service/characteristic
       * stay reachable because the service is declared in optionalServices. */
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID]
      });

      device.addEventListener('gattserverdisconnected', onDisconnected);

      const server  = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      characteristic = await service.getCharacteristic(WRITE_UUID);
      connected = true;

      /* start from a known-stopped state */
      await stopEverything();

      setPill('Connected', true);
      return true;
    } catch (e) {
      connected = false;
      characteristic = null;
      setPill('Tap to connect', false);
      return false;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

/* ------------------------------------------------------------- press logic */

async function press(dir) {
  if (held) {
    return;                       /* never both buttons at once */
  }
  held = dir;
  const el = dir === 'up' ? btnUp : btnDown;
  el.classList.add('held');

  const startCmd = dir === 'up' ? CMD.upStart : CMD.downStart;

  if (!connected) {
    const ok = await connect();
    if (!ok || held !== dir) {
      /* connection failed, or the finger was already released: never start */
      held = null;
      el.classList.remove('held');
      return;
    }
  }
  await writeChunk(startCmd);
}

async function release(dir) {
  if (held !== dir) {
    return;
  }
  held = null;
  const el = dir === 'up' ? btnUp : btnDown;
  el.classList.remove('held');
  await writeChunk(dir === 'up' ? CMD.upStop : CMD.downStop);
}

function attachButton(el, dir) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    press(dir);
  });

  el.addEventListener('pointerup', (e) => { e.preventDefault(); release(dir); });
  el.addEventListener('pointercancel', () => release(dir));
  el.addEventListener('pointerleave', () => release(dir));
  el.addEventListener('pointerout', () => release(dir));

  /* no iOS long-press magnifier / text selection / callout */
  el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('dragstart', (e) => e.preventDefault());
}

attachButton(btnUp, 'up');
attachButton(btnDown, 'down');

/* --------------------------------------------------------------- safety net */

pill.addEventListener('click', () => { connect(); });

/* finger lifted anywhere (dragged off the button, multi-touch quirks, ...) */
document.addEventListener('pointerup', () => { if (held) release(held); });
document.addEventListener('pointercancel', () => { if (held) release(held); });

/* app switched away / screen locked / page hidden */
window.addEventListener('blur', () => { if (held) release(held); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && held) {
    release(held);
  }
});

/* never leave a stale highlight behind */
window.addEventListener('pagehide', () => { if (held) release(held); });

setPill('Tap to connect', false);
