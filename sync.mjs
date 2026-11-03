// Lee las impresiones terminadas en Bambu Cloud y descuenta el stock en el
// Firebase de la calculadora Arde3D. Lo lanza GitHub Actions cada 10 min.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, runTransaction, serverTimestamp, terminate } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { procesar, aplicarAms, unirTareas, migrarRanuras } from './logica.mjs';
import { leerImpresora, listarImpresoras } from './ams.mjs';

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
// Una cuenta de Bambu por socio; la segunda es opcional
const CUENTAS = [['david', process.env.BAMBU_TOKEN], ['aaron', process.env.BAMBU_TOKEN_2]]
  .filter((c) => c[1]).map(([quien, token]) => ({ quien, token }));
const NOMBRE = { david: 'David', aaron: 'Aaron' };

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

// La base de datos solo admite usuarios con sesión: entra con la cuenta de la tarea
async function entrar() {
  const { SYNC_EMAIL, SYNC_PASSWORD } = process.env;
  if (!SYNC_EMAIL || !SYNC_PASSWORD) {
    console.warn('⚠️ Faltan los secretos SYNC_EMAIL / SYNC_PASSWORD: se intenta sin sesión');
    return;
  }
  await signInWithEmailAndPassword(getAuth(app), SYNC_EMAIL, SYNC_PASSWORD);
}
const ref = (k) => doc(db, 'arde3d_data', k);
const estadoRef = ref('bambu_state');

async function guardarEstado(campos) {
  await setDoc(estadoRef, { ...campos, lastRun: new Date().toISOString() }, { merge: true });
}

async function leerTareas(token) {
  const r = await fetch('https://api.bambulab.com/v1/user-service/my/tasks?limit=20', {
    headers: {
      'Authorization': 'Bearer ' + token,
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
  if (!CUENTAS.length) throw Object.assign(new Error('Falta el secreto BAMBU_TOKEN en GitHub'), { token: true });
  await entrar();
  const est = (await getDoc(estadoRef)).data() || {};
  // De quién es cada impresora: se apunta la primera vez que aparece y luego no cambia
  const duenos = { ...(est.duenos || {}) };
  const avisos = [];
  const porCuenta = [], impresoras = [];
  let primerError = null;

  for (const c of CUENTAS) {
    try {
      porCuenta.push({ quien: c.quien, tareas: await leerTareas(c.token) });
    } catch (e) {
      // Si falla una cuenta, la otra sigue funcionando
      if (!primerError) primerError = e;
      avisos.push(NOMBRE[c.quien] + ': ' + e.message);
      continue;
    }
    // Estado en directo del AMS (colores, % restante, RFID). Si falla, el resto sigue igual.
    try {
      for (const dev of await listarImpresoras(c.token)) {
        if (!duenos[dev.dev_id]) duenos[dev.dev_id] = c.quien;
        if (impresoras.some((i) => i.serial === dev.dev_id)) continue;
        try {
          impresoras.push({ ...(await leerImpresora(c.token, dev)), dueno: duenos[dev.dev_id] });
        } catch (e) {
          avisos.push((dev.name || 'Impresora') + ': ' + e.message);
        }
      }
    } catch (e) {
      avisos.push(NOMBRE[c.quien] + ': ' + e.message);
    }
  }
  if (!porCuenta.length) throw primerError;
  avisos.forEach((a) => console.warn('⚠️ ' + a));
  const avisoAms = avisos.join(' · ') || null;
  if (impresoras.length) await setDoc(ref('bambu_live'), { impresoras, leidoEn: new Date().toISOString() });
  const tareas = unirTareas(porCuenta, duenos);
  // La impresora de David es la de antes: sus ranuras guardadas sin serial son de ella
  const principal = Object.keys(duenos).find((s) => duenos[s] === 'david');

  // Primera vez: solo marca desde cuándo contar, para no descontar el historial antiguo
  const since = est.since || new Date().toISOString();
  if (!est.since) console.log('Primera ejecución: contaré las impresiones que terminen a partir de ahora.');

  const res = await runTransaction(db, async (tx) => {
    const claves = ['f3d', 'ams3d', 'imp3d', 'ped3d'];
    const snaps = await Promise.all(claves.map((k) => tx.get(ref(k))));
    const datos = {};
    claves.forEach((k, i) => { datos[k] = (snaps[i].exists() && snaps[i].data().items) || []; });
    const migradas = migrarRanuras(datos.ams3d, principal);
    const r = procesar(tareas, datos, since);
    // Después de descontar, el % real del AMS manda sobre las bobinas RFID
    const a = aplicarAms(datos, impresoras, Date.now());
    r.cambios.f3d = r.cambios.f3d || a.f3d;
    r.cambios.ams3d = a.ams3d || migradas;
    r.nuevos = a.nuevos;
    for (const k of ['f3d', 'ams3d', 'imp3d', 'ped3d']) {
      if (r.cambios[k]) tx.set(ref(k), { items: datos[k], updatedBy: QUIEN, updatedAt: serverTimestamp() });
    }
    return r;
  });
  await guardarEstado({ since, error: null, avisoAms, duenos });
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
