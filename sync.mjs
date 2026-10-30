// Lee las impresiones terminadas en Bambu Cloud y descuenta el stock en el
// Firebase de la calculadora Arde3D. Lo lanza GitHub Actions cada 10 min.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, runTransaction, serverTimestamp, terminate } from 'firebase/firestore';
import { procesar, aplicarAms } from './logica.mjs';
import { leerImpresora } from './ams.mjs';

// Misma configuración pública que calculadora3d.html
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCKYKC0EM_PtuElsAxb9EUoXUfb_xICqhU',
  authDomain: 'arde-3dcalc.firebaseapp.com',
  projectId: 'arde-3dcalc',
  storageBucket: 'arde-3dcalc.firebasestorage.app',
  messagingSenderId: '1081747480900',
  appId: '1:1081747480900:web:0ce6bb2603f735a6fbb711'
};
const QUIEN = 'bambu';
const TOKEN = process.env.BAMBU_TOKEN;

const db = getFirestore(initializeApp(FIREBASE_CONFIG));
const ref = (k) => doc(db, 'arde3d_data', k);
const estadoRef = ref('bambu_state');

async function guardarEstado(campos) {
  await setDoc(estadoRef, { ...campos, lastRun: new Date().toISOString() }, { merge: true });
}

async function leerTareas() {
  const r = await fetch('https://api.bambulab.com/v1/user-service/my/tasks?limit=20', {
    headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'User-Agent': 'bambu_network_agent/01.09.05.01',
      'X-BBL-Client-Name': 'OrcaSlicer',
      'X-BBL-Client-Type': 'slicer',
      'X-BBL-Client-Version': '01.09.05.51',
      'X-BBL-Language': 'es-ES',
      'accept': 'application/json'
    }
  });
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Token de Bambu caducado o no válido: genera uno nuevo con login.ps1'), { token: true });
  if (!r.ok) throw new Error('Bambu Cloud respondió ' + r.status);
  const j = await r.json();
  return j.hits || [];
}

async function main() {
  if (!TOKEN) throw Object.assign(new Error('Falta el secreto BAMBU_TOKEN en GitHub'), { token: true });
  const est = (await getDoc(estadoRef)).data() || {};
  const tareas = await leerTareas();

  // Estado en directo del AMS (colores, % restante, RFID). Si falla, el resto sigue igual.
  let live = null, avisoAms = null;
  try {
    live = await leerImpresora(TOKEN);
    await setDoc(ref('bambu_live'), { ...live, leidoEn: new Date().toISOString() });
  } catch (e) {
    avisoAms = e.message;
    console.warn('⚠️ AMS: ' + e.message);
  }

  // Primera vez: solo marca desde cuándo contar, para no descontar el historial antiguo
  const since = est.since || new Date().toISOString();
  if (!est.since) console.log('Primera ejecución: contaré las impresiones que terminen a partir de ahora.');

  const res = await runTransaction(db, async (tx) => {
    const claves = ['f3d', 'ams3d', 'imp3d', 'ped3d'];
    const snaps = await Promise.all(claves.map((k) => tx.get(ref(k))));
    const datos = {};
    claves.forEach((k, i) => { datos[k] = (snaps[i].exists() && snaps[i].data().items) || []; });
    const r = procesar(tareas, datos, since);
    // Después de descontar, el % real del AMS manda sobre las bobinas RFID
    const a = live ? aplicarAms(datos, live, Date.now()) : { f3d: false, ams3d: false, nuevos: [] };
    r.cambios.f3d = r.cambios.f3d || a.f3d;
    r.cambios.ams3d = a.ams3d;
    r.nuevos = a.nuevos;
    for (const k of ['f3d', 'ams3d', 'imp3d', 'ped3d']) {
      if (r.cambios[k]) tx.set(ref(k), { items: datos[k], updatedBy: QUIEN, updatedAt: serverTimestamp() });
    }
    return r;
  });
  await guardarEstado({ since, error: null, avisoAms });
  console.log(res.nuevas ? res.nuevas + ' impresión(es) nueva(s) procesada(s).' : 'Sin impresiones nuevas.');
  if (res.nuevos.length) console.log('Filamentos nuevos por RFID: ' + res.nuevos.join(', '));
}

let codigo = 0;
try {
  await main();
} catch (e) {
  console.error('❌ ' + e.message);
  try { await guardarEstado({ error: e.message, tokenCaducado: !!e.token }); } catch (_) {}
  codigo = 1;
}
await terminate(db);
process.exit(codigo);
