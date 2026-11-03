# Arde3D · Conexión automática con la Bambu P1S

Cada 10 minutos GitHub mira tu cuenta de Bambu Cloud. Cuando termina una impresión:

- descuenta los gramos de cada ranura del AMS en **🧵 Filamentos**;
- si el nombre del archivo contiene el texto de un pedido, suma las unidades en **📋 Pedidos**;
- lo apunta en **🖨️ Impresora**. Las impresiones fallidas, o de ranuras sin asignar, quedan ahí para que las revises.

En cada pasada también lee el AMS en directo, igual que Bambu Handy: color, material, % restante y etiqueta RFID de cada ranura.
- **Bobinas con RFID** (las de Bambu): se dan de alta solas en Stock y su stock se ajusta al % real que marca el AMS. Si ya tenías ese filamento apuntado a mano, se enlaza con él: lo que sobra se cuenta como bobinas cerradas.
- **Bobinas sin RFID**: elige en 🖨️ Impresora qué filamento es cada una. Se descuentan por los gramos que dice cada impresión.

No hace falta tener nada encendido en casa. La impresora solo tiene que estar conectada a tu cuenta de Bambu (lo normal si usas Bambu Handy o Bambu Studio en modo nube).

---

## Puesta en marcha (una sola vez, unos 15 min)

### 1. Crea el repositorio en GitHub
1. Crea una cuenta en <https://github.com> si no tienes.
2. Arriba a la derecha, **+ → New repository**. Nombre: `arde3d-bambu-sync`. Márcalo como **Public** (así las ejecuciones son gratis e ilimitadas; el token de Bambu va aparte, en un secreto que nadie ve).
3. En el repo nuevo: **Add file → Upload files** y arrastra **todo el contenido** de esta carpeta, incluida la carpeta oculta `.github`. Si el Explorador no la muestra: Vista → Mostrar → Elementos ocultos. Luego **Commit changes**.

### 2. Consigue el token de Bambu
1. En esta carpeta, clic derecho en `login.ps1` → **Ejecutar con PowerShell**.
2. Escribe tu email y tu contraseña de Bambu. Si te pide un código, te llegará por email (o lo verás en tu app de verificación en dos pasos).
3. El token queda copiado en el portapapeles.

> Si Windows no deja ejecutarlo, abre PowerShell en esta carpeta y lanza:
> `powershell -ExecutionPolicy Bypass -File login.ps1`

### 3. Guarda el token en GitHub
En el repo: **Settings → Secrets and variables → Actions → New repository secret**
- Name: `BAMBU_TOKEN`
- Secret: pega el token (Ctrl+V)

### 4. Arráncalo
**Actions → Bambu → Arde3D → Run workflow**. La primera vez solo apunta «a partir de ahora», así no descuenta tus impresiones antiguas. Desde entonces se lanza solo cada 10 minutos (GitHub a veces se retrasa unos minutos).

### 5. En la app
1. Pestaña **🖨️ Impresora**: elige qué bobina hay en cada ranura del AMS. Debe salir 🟢 «Conectada a Bambu Cloud».
2. Pestaña **📋 Pedidos**: crea los pedidos. En «Texto del nombre de archivo» pon algo que aparezca en el nombre del archivo que mandas a imprimir (por ejemplo `carwash`). Así se cuentan solos.
3. Para que Pedidos calcule el filamento que hace falta, el producto tiene que estar guardado en **📦 Mis Productos** con un filamento de «Mis filamentos». Los productos guardados antes de esta versión hay que volver a guardarlos una vez.

### 6. La impresora de tu socio (opcional)
1. Tu socio ejecuta `login.bat` con **su** cuenta de Bambu.
2. Guarda su token en GitHub como otro secreto: Name `BAMBU_TOKEN_2`.
3. Espera una pasada (10 min): su impresora queda apuntada como suya. **Después** os podéis compartir las impresoras en Bambu Handy. Si se comparten antes, la tarea podría apuntar la impresora de tu socio como tuya.

Cada filamento tiene dueño («Dónde está» en Stock). Las bobinas RFID de cada AMS se dan de alta en el stock del dueño de esa impresora. En 🖨️ Impresora cada impresión dice en qué impresora se hizo y quién la mandó.

---

## Mantenimiento
- **Cada ~3 meses** caduca el token. La app lo avisa en 🖨️ Impresora (🔴 Token caducado) y GitHub te manda un email. Repite los pasos 2 y 3.
- **Cuando cambies una bobina en el AMS**, cámbiala también en 🖨️ Impresora.
- Si la app dice «Lleva un rato sin comprobar», entra en GitHub → Actions y pulsa **Enable workflow** si aparece.

## Límites a saber
- Bambu da el peso **previsto** por el laminador. Para impresiones canceladas o fallidas no se sabe lo que se gastó de verdad: por eso no se descuentan solas, te las pone para revisar.
- La conexión con Bambu Cloud **no es oficial**. Si Bambu la cambia, puede dejar de funcionar hasta que se ajuste el script. Mientras tanto, el botón manual «📉 Descontar del stock» sigue funcionando.

## Archivos
| Archivo | Qué hace |
|---|---|
| `sync.mjs` | Lee Bambu Cloud y actualiza Firebase |
| `logica.mjs` | Las reglas de descuento, pedidos y bobinas RFID |
| `ams.mjs` | Lee el AMS en directo por MQTT de Bambu Cloud |
| `sondeo.mjs` | Prueba manual: Actions → «Sondeo impresora» muestra lo que ve la impresora |
| `login.ps1` | Saca el token de Bambu (se ejecuta en tu PC) |
| `.github/workflows/bambu-sync.yml` | La tarea de GitHub que lo lanza cada 10 min |
