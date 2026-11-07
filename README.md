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

## Estructura

- `js/engine.js`: calcula los viajes con el límite de buses, los precios y los transbordos.
- `js/geo.js`: direcciones de Bogotá y búsqueda de lugares.
- `js/app.js`: la interfaz.
- `app.css`, `index.src.html`: diseño y página.
- `data/network.json`: rutas empaquetadas. `data/shapes.json`: el trazado por calles. `data/grid.json`: las esquinas para ubicar direcciones.
- `config.json`: responsable, contacto y a dónde llegan los reportes de error.
- `docs/`: cómo publicar, qué pasa si fallan los servicios gratuitos, y la carta a TransMilenio sobre el uso de los datos.

## Créditos

Rutas: datos abiertos de TransMilenio. Mapa y direcciones: © colaboradores de OpenStreetMap (ODbL), OpenFreeMap y OpenMapTiles. Búsqueda: Photon, de komoot. Mapa: MapLibre.
