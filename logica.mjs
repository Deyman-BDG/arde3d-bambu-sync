// Lógica pura: recibe las impresiones de Bambu Cloud y los datos de la app,
// y devuelve los datos actualizados. Sin red, para poder probarla aparte.

export const MAX_REGISTRO = 100;

// Clave de ranura igual que en la app: "0-0".."0-3" para el AMS 1, "ext" para la bobina externa
export function claveRanura(m) {
  var amsId = m.amsId, slotId = m.slotId;
  if (amsId == null || slotId == null) {
    if (m.ams == null) return 'ext';
    if (m.ams >= 254) return 'ext';
    amsId = Math.floor(m.ams / 4); slotId = m.ams % 4;
  }
  if (amsId >= 254) return 'ext';
  return amsId + '-' + slotId;
}

export function normalizar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function terminada(t) {
  if (t.status !== 2 && t.status !== 3) return false;
  if (!t.endTime || !t.startTime) return false;
  // endTime pegado a startTime = aún imprimiendo
  return new Date(t.endTime) - new Date(t.startTime) > 60000;
}

// Pedido pendiente cuyo texto aparece en el nombre de la impresión (el de entrega más cercana)
function buscarPedido(pedidos, titulo) {
  var t = ' ' + normalizar(titulo) + ' ';
  var cand = pedidos.filter(function (p) {
    if (p.estado === 'entregado' || (p.hechas || 0) >= p.cant) return false;
    var a = normalizar(p.alias || p.prodNom);
    return a && t.indexOf(' ' + a + ' ') >= 0;
  });
  cand.sort(function (a, b) { return (a.entrega || '9999').localeCompare(b.entrega || '9999'); });
  return cand[0] || null;
}

// tasks: hits de /my/tasks · datos: { f3d, ams3d, imp3d, ped3d } (arrays) · since: ISO
export function procesar(tasks, datos, since) {
  var fils = datos.f3d, ams = datos.ams3d, reg = datos.imp3d, peds = datos.ped3d;
  var vistos = new Set(reg.map(function (r) { return String(r.id); }));
  var nuevas = tasks
    .filter(function (t) { return terminada(t) && t.endTime > since && !vistos.has(String(t.id)); })
    .sort(function (a, b) { return a.endTime.localeCompare(b.endTime); });

  var cambios = { f3d: false, imp3d: false, ped3d: false };
  nuevas.forEach(function (t) {
    var ok = t.status === 2;
    var titulo = t.title || t.designTitle || 'Impresión';
    var entrada = {
      id: String(t.id), titulo: titulo, fin: t.endTime, estado: ok ? 'ok' : 'fallida',
      impresora: t.deviceName || '', slots: [], revisar: !ok
    };
    var mapping = (t.amsDetailMapping && t.amsDetailMapping.length)
      ? t.amsDetailMapping
      : [{ ams: 255, weight: t.weight, filamentType: '', sourceColor: '' }];
    mapping.forEach(function (m) {
      var g = Math.round((parseFloat(m.weight) || 0) * 10) / 10;
      if (g <= 0) return;
      var slot = claveRanura(m);
      var asig = ams.find(function (a) { return a.slot === slot; });
      var fl = asig && fils.find(function (f) { return f.id === asig.filId; });
      var s = { slot: slot, tipo: m.filamentType || '', color: (m.sourceColor || '').slice(0, 6), g: g, filId: fl ? fl.id : null, descontado: false };
      if (ok && fl) {
        fl.stock = Math.max(0, Math.round((fl.stock - g) * 10) / 10);
        s.descontado = true;
        cambios.f3d = true;
      } else {
        entrada.revisar = true;
      }
      entrada.slots.push(s);
    });

    if (ok) {
      var ped = buscarPedido(peds, titulo);
      if (ped) {
        ped.hechas = Math.min(ped.cant, (ped.hechas || 0) + (ped.udsPorImp || 1));
        if (ped.hechas >= ped.cant && ped.estado === 'pendiente') ped.estado = 'listo';
        entrada.pedidoId = ped.id;
        entrada.pedidoTxt = ped.cliente + ' · ' + ped.prodNom;
        cambios.ped3d = true;
      }
    }
    reg.unshift(entrada);
    cambios.imp3d = true;
  });
  datos.imp3d = reg.slice(0, MAX_REGISTRO);
  return { nuevas: nuevas.length, cambios: cambios };
}

// ═══════ STOCK DESDE LAS BOBINAS RFID DEL AMS ═══════
// Cada filamento RFID agrupa sus bobinas por material+color (rfidKey):
// stock = suma de lo que queda en cada bobina (según el AMS) + extra (bobinas cerradas que repones a mano).

const PALETA = [
  ['FFFFFF', 'Blanco'], ['000000', 'Negro'], ['8E9089', 'Gris'], ['D1D3D5', 'Gris claro'], ['A6A9AA', 'Plata'],
  ['C12E1F', 'Rojo'], ['9D2235', 'Granate'], ['FF6A13', 'Naranja'], ['F4EE2A', 'Amarillo'], ['E4BD68', 'Dorado'],
  ['00AE42', 'Verde'], ['6B7A2B', 'Verde oliva'], ['A5DAB4', 'Verde menta'], ['0A2989', 'Azul'], ['56B7E6', 'Azul cielo'],
  ['0086D6', 'Cian'], ['5E43B7', 'Morado'], ['AE96D4', 'Lila'], ['F55A74', 'Rosa'], ['F5B6CD', 'Rosa claro'],
  ['9D432C', 'Marrón'], ['F7E6DE', 'Beige'], ['B15533', 'Terracota']
];
const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
export function nombreColor(hex) {
  if (!/^[0-9A-F]{6}$/i.test(hex || '')) return 'Sin color';
  const c = rgb(hex);
  let mejor = PALETA[0], dist = Infinity;
  PALETA.forEach((p) => {
    const q = rgb(p[0]);
    const d = (c[0] - q[0]) ** 2 * 0.3 + (c[1] - q[1]) ** 2 * 0.59 + (c[2] - q[2]) ** 2 * 0.11;
    if (d < dist) { dist = d; mejor = p; }
  });
  return mejor[1];
}

const PRECIO_KG = { 'PLA Basic': 19.99, 'PLA Matte': 19.99, 'PETG HF': 19.99, 'PETG Basic': 19.99, 'ASA': 24.99, 'ABS': 19.99, 'TPU': 34.99 };
const r1 = (n) => Math.round(n * 10) / 10;

// live: resumen de ams.mjs · datos: { f3d, ams3d } · devuelve qué ha cambiado
export function aplicarAms(datos, live, ahoraMs) {
  const fils = datos.f3d;
  let ams = datos.ams3d;
  const cambios = { f3d: false, ams3d: false, nuevos: [] };
  const antesAms = JSON.stringify(ams);
  const enAms = new Set();

  live.bandejas.forEach((b) => {
    // Ranura vacía o con bobina sin RFID que antes tenía una RFID: quita la asignación automática
    if (b.vacia || !b.rfid) {
      ams = ams.filter((a) => !(a.slot === b.slot && (b.vacia || a.auto)));
      return;
    }
    enAms.add(b.rfid);
    const key = 'bl-' + b.codigo + '-' + b.color;
    const gramos = b.restante != null ? Math.round(b.restante / 100 * b.peso) : null;
    const nombreTipo = b.subtipo || b.tipo;
    let fl = fils.find((f) => f.rfidKey === key);
    if (!fl) {
      // ¿Ya lo tenías dado de alta a mano? (Bambu + mismo material + mismo color)
      const col = normalizar(nombreColor(b.color));
      fl = fils.find((f) => !f.rfidKey && normalizar(f.marca).indexOf('bambu') >= 0 &&
        normalizar(nombreTipo).indexOf(normalizar(f.tipo)) >= 0 && normalizar(f.color).indexOf(col) >= 0);
      if (fl) {
        fl.rfidKey = key;
        fl.bobinas = { [b.rfid]: gramos ?? b.peso };
        fl.extra = Math.max(0, r1((fl.stock || 0) - fl.bobinas[b.rfid]));
      } else {
        fl = {
          id: 'f' + ahoraMs + fils.length, marca: 'Bambu Lab', tipo: nombreTipo, color: nombreColor(b.color),
          precio: PRECIO_KG[nombreTipo] || 24, stock: 0, min: 150, notas: 'Añadido solo desde el AMS (RFID)',
          rfidKey: key, bobinas: {}, extra: 0
        };
        fils.push(fl);
        cambios.nuevos.push(fl.marca + ' ' + fl.tipo + ' ' + fl.color);
      }
      cambios.f3d = true;
    }
    fl.colorHex = b.color;
    fl.bobinas = fl.bobinas || {};
    if (!(b.rfid in fl.bobinas)) {
      // Bobina nueva: si tenías bobinas cerradas apuntadas en "extra", sale de ahí
      if ((fl.extra || 0) >= b.peso * 0.5) fl.extra = r1(fl.extra - b.peso);
      fl.bobinas[b.rfid] = gramos ?? b.peso;
      cambios.f3d = true;
    } else if (gramos != null && fl.bobinas[b.rfid] !== gramos) {
      fl.bobinas[b.rfid] = gramos;
      cambios.f3d = true;
    }
    const a = ams.find((x) => x.slot === b.slot);
    if (!a || a.filId !== fl.id) {
      ams = ams.filter((x) => x.slot !== b.slot).concat([{ slot: b.slot, filId: fl.id, auto: true }]);
    }
  });

  // Recalcula el stock de los filamentos RFID; olvida bobinas acabadas que ya no están en el AMS
  fils.forEach((f) => {
    if (!f.rfidKey || !f.bobinas) return;
    Object.keys(f.bobinas).forEach((u) => { if (!enAms.has(u) && f.bobinas[u] <= 0) { delete f.bobinas[u]; cambios.f3d = true; } });
    const total = r1(Object.values(f.bobinas).reduce((s, g) => s + g, 0) + (f.extra || 0));
    if (f.stock !== total) { f.stock = total; cambios.f3d = true; }
  });

  datos.ams3d = ams;
  cambios.ams3d = JSON.stringify(ams) !== antesAms;
  return cambios;
}
