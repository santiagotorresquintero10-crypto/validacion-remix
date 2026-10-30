# Central Ganadera · REMIX Validación

Aplicativo web (HTML + CSS + JavaScript modular, sin React) para validar Cliente de planta, Facturador y Proveedor contra la base maestra REMIX. Usa Firebase Authentication, Cloud Firestore y Firebase Hosting.

```
cg-remix/
├── public/                  ← lo que se publica
│   ├── index.html
│   ├── css/styles.css
│   ├── assets/logo.png      ← logo (marca CG) y logo-completo.png
│   └── js/
│       ├── firebase-config.js   ← configuración del proyecto (ya diligenciada)
│       ├── engine.js            ← motor de validación (sin dependencias)
│       ├── data.js              ← Firebase (login, REMIX, equivalencias, historial)
│       └── app.js               ← interfaz
├── firestore.rules          ← reglas de seguridad
├── firebase.json
├── tests/engine.test.mjs    ← 39 pruebas del motor
└── ejemplos/                ← REMIX e informe diario de prueba
```

---

## Paso a paso (≈ 30 minutos, una sola vez)

### 1. Instalar herramientas en su computador
1. Instale **Node.js LTS** desde https://nodejs.org (siguiente, siguiente, finalizar).
2. Abra una terminal (Windows: «Símbolo del sistema» o PowerShell) y ejecute:
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
   Se abrirá el navegador: ingrese con la cuenta Google de la empresa que será dueña del proyecto.

### 2. Crear el proyecto Firebase
1. Entre a https://console.firebase.google.com → **Agregar proyecto** → nombre: `central-ganadera-remix` → Google Analytics: no es necesario → Crear.
2. **Authentication** → Comenzar → pestaña *Sign-in method* → habilite **Correo electrónico/contraseña** (solo el primer interruptor) → Guardar.
3. **Firestore Database** → Crear base de datos → modo **producción** → ubicación `southamerica-east1 (São Paulo)` o `us-east1` → Habilitar.
   *(La ubicación no se puede cambiar después.)*
4. ⚙ **Configuración del proyecto** → General → *Tus apps* → icono **</>** (Web) → apodo `remix-web` → Registrar. *(Ya hecho.)*

### 3. Preparar el proyecto en su computador
`firebase-config.js` y el logo ya vienen listos. Descomprima el ZIP, abra PowerShell en la carpeta `cg-remix` y ejecute:
```bash
firebase use --add
```
Elija `central-ganadera-remix` y como alias escriba `default`.

### 4. Publicar
```bash
firebase deploy --only firestore:rules,hosting
```
Al terminar muestra la dirección: `https://central-ganadera-remix.web.app`.

### 5. Crear usuarios
Firebase Console → **Authentication** → Usuarios → **Agregar usuario** → correo y contraseña. Listo: con eso ya entra. No hay roles, activación ni verificación; todos los usuarios pueden validar, cargar REMIX y decidir equivalencias.

Para quitarle el acceso a alguien: en esa misma lista, menú ⋮ → **Inhabilitar cuenta**.

**Recomendado (2 minutos):** en Authentication → **Configuración** → *Acciones del usuario*, si aparece la opción **«Habilitar la creación (registro)»**, desactívela. Así solo existen los usuarios que usted crea en la consola. Sin ese ajuste, alguien que conozca la página podría registrarse por fuera.

### 6. Cargar REMIX
⚙ → pestaña **REMIX** → *Cargar nueva versión* → elija el archivo original. Puede tener todas las columnas que quiera: el sistema toma **solo** `Cliente de planta`, `Facturar a Nombre de` (como facturador) y `Proveedor`, y descarta el resto, **incluida la columna `Facturador` del REMIX**. Antes de publicar muestra un resumen (filas, nombres distintos, filas incompletas, diferencias contra la versión anterior y equivalencias afectadas). Pulse *Publicar y activar*.

### 7. Informe diario
Debe tener tres columnas llamadas exactamente **Cliente de planta**, **Facturador** y **Proveedor** (el orden no importa; puede tener más columnas y una fila de título arriba). Si falta alguna, el archivo se rechaza con un mensaje. Las columnas adicionales (fecha, lote, kilos, etc.) se muestran en la tabla y salen en todos los Excel exportados, pero **no se validan**.

---

## Columnas que se comparan

| Informe diario | se compara con la columna de REMIX |
|---|---|
| Cliente planta (o «Cliente de planta») | Cliente de planta |
| Cliente factura (o «Facturador») | **Facturar a Nombre de** |
| Proveedor | Proveedor |

## Cómo valida (lo que importa para confiar en el resultado)

| Situación | Resultado |
|---|---|
| Los tres nombres coinciden (ignorando mayúsculas, tildes, espacios y puntuación) **y** están en la misma fila de REMIX. También cuando coinciden por una equivalencia aprobada. | **CORRECTO** |
| El Cliente y el Facturador ya están relacionados en REMIX, pero el Proveedor no aparece con ellos (no existe en REMIX o existe con otros). | **NUEVO PROVEEDOR** |
| El Facturador y el Proveedor ya están relacionados en REMIX, pero no con este Cliente (o el cliente no existe en REMIX). Posible cliente nuevo: validar que el facturador le corresponda. | **VALIDAR CLIENTE** |
| Error de ortografía, abreviatura, iniciales, nombre incompleto, sigla societaria faltante o nombre parecido no equivalente. | **REVISAR** |
| Un nombre sin correspondencia confiable, o campo vacío. | **NO ENCONTRADO** |
| Los tres existen pero la combinación no está en REMIX y no encaja en los casos anteriores (p. ej., Cliente y Proveedor relacionados con otro Facturador). | **RELACIÓN NO REGISTRADA** |
| El Proveedor contiene «Central Ganadera» (con o sin S.A., tildes o puntos). Se valida igual contra REMIX y el resultado queda en la columna «Validación REMIX». | **PROVEEDOR CENTRAL GANADERA** |

**Filtros y exportación:** las tarjetas de resumen son filtros. El botón de exportar descarga exactamente lo que se ve:
- *Todos* → hojas Resultados, Nuevos proveedores, Validar cliente, Central Ganadera y Advertencias.
- *Central Ganadera* → los registros con ese proveedor y su resultado de validación.
- *Nuevo proveedor* → lista de proveedores nuevos con los proveedores que ya tiene registrados ese cliente y facturador.
- *Validar cliente* → lista con los clientes que REMIX tiene para ese facturador y proveedor.
- *Revisar / No encontrados / Relación no registrada* → una fila por diferencia (Cliente, Facturador, Proveedor, Campo con diferencia, Nombre en REMIX, Advertencia).

Reglas de diseño:
- Cada campo se compara **solo** con su columna. Un nombre que existe como Proveedor no sirve como Cliente.
- Las columnas del Excel se identifican **por encabezado**, no por posición. Si falta un encabezado o está repetido, el archivo se rechaza en vez de adivinar.
- Nada parecido se acepta solo: la única vía para que una diferencia real pase a «correcto» es que un usuario confirme la equivalencia («Son la misma entidad»).
- Los números nunca se “corrigen” (FINCA 1 ≠ FINCA 2).
- Las equivalencias confirmadas `SANDRA MILENA LOPEZ OSORIO = SANDRA MILENA LOPEZ` y `AGROFAR SAS = AGROFAR` (Facturador) vienen precargadas y se pueden revertir.

### Equivalencias
- En el detalle de una advertencia: *Son la misma entidad* / *Son diferentes* / *Dejar pendiente*.
- La decisión aplica de inmediato para todos los usuarios y queda registrado quién la tomó y cuándo.
- Las descartadas no vuelven a sugerirse. Todo se puede **revertir** desde ⚙ → Equivalencias.

### Versiones de REMIX
Cada carga crea una versión nueva; las anteriores se conservan y se pueden **reactivar** desde ⚙ → REMIX. Al cargar, el sistema avisa qué equivalencias quedarían sin nombre en la nueva versión y alerta si el archivo tiene menos de la mitad de filas que el actual.

---

## Tabla de resultados

**Columnas.** Orden por defecto: LOTE, NIT, CLIENTE DE PLANTA, FACTURADOR (REMIX), FACTURAR A NOMBRE DE, PROVEEDOR, CANTIDAD, FECHA BENEFICIO, DÍA DE BENEFICIO, luego las demás columnas del informe, Resultado, Advertencia, Nombre sugerido y # (fila del archivo).
- **FACTURAR A NOMBRE DE** = columna `Facturador` del informe (solo cambia el nombre visible; es el campo que se valida).
- **FACTURADOR (REMIX)** = columna `Facturador` del REMIX original. Es **solo informativa**, no interviene en la validación. Sale de la fila REMIX de esa relación; si la relación completa no existe, de las filas con el mismo Cliente + Facturar a nombre de (en cursiva). Requiere volver a cargar el REMIX una vez para que se guarde; si el REMIX activo no lo trae, la tabla lo avisa. Acepta encabezados como «Facturador», «FACTURADOR REMIX» o «Nombre del facturador».
- Arrastre los encabezados para reordenar. LOTE queda fija al inicio; NIT (visible como «NIT Facturar a nombre de») sale segunda por defecto y se puede mover. El orden se guarda en ese navegador; «Restablecer columnas» vuelve al orden por defecto.

**Chulito (columna Gestión).** Aparece en filas con novedad (Nuevo proveedor, Validar cliente, Revisar, No encontrado, Relación no registrada).
- Al marcarlo, el registro pasa a **Correctos** (insignia «✓ Manual») y los contadores se actualizan. Se vuelve a desmarcar con el mismo botón.
- Se guarda en Firebase para todo el equipo, con quién y cuándo. Nunca se borra el detalle original de la validación.
- En una nueva carga, la confirmación solo se reaplica si es **el mismo registro** (Lote + NIT + los tres nombres) **y la misma novedad**. Si la novedad cambió, no se aplica y la fila lo avisa.
- En Excel: columnas «Tipo de correcto» (Automático / Automático (equivalencia) / Confirmación manual), «Validación REMIX» (novedad original), «Confirmado por» y «Fecha confirmación»; al exportar «Todos» sale además la hoja «Confirmados manualmente».

**Recargar la página** no borra los resultados: la última validación se guarda en el navegador de cada usuario hasta que pulse «Limpiar».

## Pruebas
```bash
node tests/engine.test.mjs
```
Cubre normalización, equivalencias, ortografía, identidad, columnas invertidas, relaciones de filas distintas, decisiones descartadas/revertidas, lectura de encabezados y rendimiento (25 filas contra 6.000 relaciones).

Para probar a mano use `ejemplos/REMIX_ejemplo.xlsx` (cárguelo como REMIX) y `ejemplos/informe_diario_ejemplo.xlsx` (tiene las columnas en otro orden y una fila de título, a propósito).

## Costos
Con el plan gratuito (Spark) alcanza para un equipo pequeño: cada apertura de la app lee unos pocos documentos (REMIX se guarda en bloques de 2.500 filas y además queda en caché del navegador por versión).

## Actualizar la aplicación
Edite los archivos y vuelva a ejecutar `firebase deploy --only firestore:rules,hosting`.
