// Lee el estado en directo de la impresora (AMS, colores, % restante, RFID)
// por el MQTT de Bambu Cloud, igual que Bambu Handy.
import mqtt from 'mqtt';

const API = 'https://api.bambulab.com';
const HEADERS = (token) => ({
  'Authorization': 'Bearer ' + token,
  'User-Agent': 'bambu_network_agent/01.09.05.01',
  'X-BBL-Client-Name': 'OrcaSlicer',
  'X-BBL-Client-Type': 'slicer',
  'X-BBL-Client-Version': '01.09.05.51',
  'accept': 'application/json'
});

async function getJson(url, token) {
  const r = await fetch(url, { headers: HEADERS(token) });
  if (!r.ok) throw new Error(url.split('/').slice(-2).join('/') + ' → ' + r.status);
  return r.json();
}

// Usuario MQTT: "u_<uid>". Sale del propio token (JWT) o de las preferencias de la cuenta
async function usuarioMqtt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (payload.username) return payload.username;
  } catch (_) {}
  const pref = await getJson(API + '/v1/design-user-service/my/preference', token);
  return 'u_' + pref.uid;
}

const UUID_VACIO = /^0*$/;

// Pasa el informe "pushall" de la impresora a algo pequeño y estable para la app
export function resumirInforme(p, dev) {
  const ams = p.ams || {};
  const bandejas = [];
  (ams.ams || []).forEach((u) => {
    (u.tray || []).forEach((t) => bandejas.push(bandeja(Number(u.id) + '-' + Number(t.id), t, u)));
  });
  if (p.vt_tray) bandejas.push(bandeja('ext', p.vt_tray, null));
  return {
    impresora: dev.name || dev.dev_product_name || 'Impresora',
    modelo: dev.dev_product_name || '',
    online: dev.online !== false,
    estado: p.gcode_state || '',
    progreso: p.mc_percent ?? null,
    minutosRestantes: p.mc_remaining_time ?? null,
    trabajo: p.subtask_name || '',
    humedad: (ams.ams || []).map((u) => Number(u.humidity)).filter((n) => !isNaN(n)),
    enUso: ams.tray_now != null ? String(ams.tray_now) : null,
    bandejas
  };
}

function bandeja(slot, t, unidad) {
  const vacia = !t || !t.tray_type;
  if (vacia) return { slot, vacia: true };
  const uuid = t.tray_uuid && !UUID_VACIO.test(t.tray_uuid) ? t.tray_uuid : null;
  const remain = Number(t.remain);
  return {
    slot,
    vacia: false,
    tipo: t.tray_type || '',
    subtipo: t.tray_sub_brands || '',
    color: (t.tray_color || '').slice(0, 6).toUpperCase(),
    codigo: t.tray_info_idx || '',
    peso: Number(t.tray_weight) || 1000,
    restante: remain >= 0 && remain <= 100 ? remain : null,
    rfid: uuid
  };
}

// Conecta, pide el estado completo (pushall) y devuelve el resumen. Máx ~20 s.
export async function leerImpresora(token) {
  const binds = await getJson(API + '/v1/iot-service/api/user/bind', token);
  const dev = (binds.devices || [])[0];
  if (!dev) throw new Error('No hay ninguna impresora vinculada a la cuenta');
  const usuario = await usuarioMqtt(token);

  return new Promise((resolve, reject) => {
    const cli = mqtt.connect('mqtts://us.mqtt.bambulab.com:8883', {
      username: usuario, password: token, clientId: 'arde3d_' + Math.random().toString(16).slice(2, 10),
      reconnectPeriod: 0, connectTimeout: 10000
    });
    let informe = {};
    const fin = (err) => {
      clearTimeout(reloj);
      cli.end(true);
      if (informe.ams) resolve(resumirInforme(informe, dev));
      else reject(err || new Error('La impresora no ha enviado el estado del AMS' + (dev.online === false ? ' (está apagada o sin conexión)' : '')));
    };
    const reloj = setTimeout(() => fin(), 20000);
    cli.on('connect', () => {
      cli.subscribe('device/' + dev.dev_id + '/report', (err) => {
        if (err) return fin(new Error('MQTT: no se pudo suscribir (' + err.message + ')'));
        cli.publish('device/' + dev.dev_id + '/request', JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } }));
      });
    });
    cli.on('message', (_t, buf) => {
      try {
        const p = JSON.parse(buf.toString()).print;
        if (!p) return;
        informe = { ...informe, ...p };
        if (p.command === 'push_status' && p.ams && p.ams.ams) fin();
      } catch (_) {}
    });
    cli.on('error', (e) => fin(new Error('MQTT: ' + e.message)));
  });
}
