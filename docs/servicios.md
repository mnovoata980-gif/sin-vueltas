# Plan si fallan los servicios gratuitos

Sin Vueltas no tiene servidor propio. Depende de servicios gratuitos que no prometen nada, así que cada uno tiene un comportamiento definido cuando falla y un respaldo posible. Revisado el 7 de noviembre de 2026.

## Qué pasa hoy cuando cada uno falla

| Servicio | Para qué se usa | Condiciones | Si falla, la app | Respaldo posible |
|---|---|---|---|---|
| **Archivo GTFS de TransMilenio** | Todas las rutas | Público, sin licencia indicada (ver `carta-permiso-datos.md`) | Conserva las últimas rutas buenas. La actualización diaria rechaza un archivo recortado (el del festivo del 2 de noviembre traía 6 viajes de día hábil) y GitHub avisa por correo. Si las rutas pasan de 14 días, la app lo dice. | Ninguno: es la única fuente oficial. |
| **Photon** (komoot), buscador de direcciones | Direcciones y lugares | Uso razonable, sin garantía de disponibilidad. Los mantenedores dicen que el servicio público es para pruebas. | Si no responde en 6 s, o falla dos veces seguidas, deja de preguntarle durante 5 minutos. Mientras tanto se puede buscar por estación, paradero, categoría y en el mapa. Las respuestas se recuerdan para no repetir búsquedas. | Montar Photon propio con los datos de Colombia en un servidor pequeño de pago. Nominatim, el otro buscador gratuito de OpenStreetMap, prohíbe el autocompletado. |
| **OpenFreeMap**, mapa de calles | Fondo del mapa | Sin límites. Exige dar crédito, y la app lo muestra. | A los 8 s sin respuesta usa el mapa propio, con estaciones y rutas pero sin calles. | Alojar un archivo PMTiles solo de Bogotá en el mismo sitio de GitHub Pages. No necesita servidor, pero pesa varias decenas de MB y requiere una librería más. |
| **unpkg**, librería MapLibre | Dibujar el mapa de calles | Gratis | Mapa propio | Copiar la librería (unos 220 KB) dentro del sitio. Su licencia BSD lo permite. |
| **Google Fonts**, letra Rubik | Apariencia | Gratis | Letra del sistema. En modo ligero ni se pide. | — |
| **GitHub Pages y Actions** | Alojar la app y actualizar rutas cada día | Gratis para repositorios públicos. Sitio de hasta 1 GB y un tráfico sugerido de 100 GB al mes, que alcanza para unas 200.000 primeras visitas. | Si GitHub cae, la app instalada sigue funcionando con su copia guardada. | Cloudflare Pages o Netlify, que publican la misma carpeta `site/` sin cambios. |

## Créditos que exigen

- OpenStreetMap (ODbL): «© colaboradores de OpenStreetMap». Aparece en el pie de la app, en el mapa y en la hoja de privacidad.
- OpenFreeMap y OpenMapTiles: MapLibre los añade solo en el mapa, y también aparecen en el pie.
- Photon: se nombra en el pie.

## Dónde se cambia cada servicio

- Buscador: `PHOTON` en `js/geo.js`.
- Mapa de calles: la dirección del estilo en `initReal` y `MAP_LIB` en `js/app.js`.
- Letra: `FONT_URL` en `build.js`.

## Cuándo pasar a un respaldo

- Si Photon se pausa varias veces al día en la prueba en la calle, conviene montar el buscador propio.
- Si OpenFreeMap tarda más de 8 s con frecuencia, conviene el archivo PMTiles de Bogotá.
- Copiar MapLibre dentro del sitio es barato y quita una dependencia. Puede hacerse antes de publicar.
