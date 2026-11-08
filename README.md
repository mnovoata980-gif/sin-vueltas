# Sin Vueltas

Rutas de TransMilenio y SITP en Bogotá con el número de buses que tú decides. App web gratuita y **no oficial**: las rutas salen de los archivos públicos de TransMilenio (GTFS).

## Probar en el computador

```bash
node serve.js
```

Abre `http://localhost:5175` (versión web) o `http://localhost:5175/preview` (versión de un solo archivo). Con `?sw=1` se activa el modo sin conexión en localhost.

## Actualizar las rutas

```bash
node tools/update.js
```

Baja el archivo más reciente de TransMilenio, lo empaqueta (`tools/build-data.js`), lo audita ruta por ruta (`tools/audit-routes.js`), corre las pruebas (`tools/test-engine.js`) y construye la app (`build.js`). Si algo falla, la app conserva las rutas anteriores. Toma poco más de un minuto.

## Actualizar las esquinas (direcciones)

```bash
node tools/build-grid.js
```

Baja de OpenStreetMap las calles con nomenclatura de Bogotá y guarda en `data/grid.json` cada esquina de una calle (o diagonal) con una carrera (o transversal). Con esa tabla la app ubica «Calle 72 # 10-20» por la lógica de la ciudad, en el teléfono y sin internet. Descarta las esquinas que no cuadran con sus vecinas (calles a las que en el mapa les falta el «Sur»). Las calles cambian poco: basta correrlo cada pocos meses.

## Modo Bici y Eléctrico

Arriba se elige si vas en bus, en bici (bicicleta o bici eléctrica) o en un vehículo eléctrico (patineta, bici-moto o ciclomotor, moto eléctrica). La ruta se calcula en el teléfono, sin servidor, y cada vehículo va solo por donde la norma lo deja: un ciclomotor nunca entra a la ciclorruta, una patineta no rueda por andenes y nadie usa los carriles de TransMilenio. En bici la ruta prefiere ciclorrutas, avisa dónde no las hay, aprovecha la ciclovía los domingos y festivos (y la moto la evita) y compara con el tiempo en bus.

```bash
node tools/build-bike.js --cache ../bike-cache
```

Baja las calles de OpenStreetMap, la red de biciusuarios del IDU, la ciclovía del IDRD y los cicloparqueaderos de TransMilenio, los cruza y guarda `data/bike.json` (unos 4 MB, 1,2 MB comprimido). El IDU publica cada tres meses: basta correrlo entonces. Las reglas por vehículo están en `data/bike-rules.json` y se pueden cambiar sin tocar el código. Pruebas: `node tools/test-bike.js` (también corren en la actualización diaria). Detalles, fuentes y límites en `docs/modo-bici.md`.

## Estructura

- `js/engine.js`: calcula los viajes con el límite de buses, los precios y los transbordos.
- `js/geo.js`: direcciones de Bogotá y búsqueda de lugares.
- `js/bike.js`: calcula las rutas en bici y en vehículo eléctrico según lo que cada vehículo puede usar.
- `js/app.js`: la interfaz.
- `app.css`, `index.src.html`: diseño y página.
- `data/network.json`: rutas empaquetadas. `data/shapes.json`: el trazado por calles. `data/grid.json`: las esquinas para ubicar direcciones. `data/bike.json`: calles y ciclorrutas para el modo Bici y Eléctrico. `data/bike-rules.json`: las reglas por vehículo.
- `config.json`: responsable, contacto y a dónde llegan los reportes de error.
- `docs/`: cómo publicar, qué pasa si fallan los servicios gratuitos, la carta a TransMilenio sobre el uso de los datos, la carta a la Secretaría de Movilidad por los tramos prohibidos a vehículos eléctricos, y cómo funciona el modo Bici.

## Créditos

Rutas: datos abiertos de TransMilenio. Ciclorrutas: red de biciusuarios del IDU (IDECA, CC BY 4.0). Ciclovía: IDRD (CC BY 4.0). Mapa y direcciones: © colaboradores de OpenStreetMap (ODbL), OpenFreeMap y OpenMapTiles. Búsqueda: Photon, de komoot. Mapa: MapLibre.
