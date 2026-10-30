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
