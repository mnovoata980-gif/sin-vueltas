# Volver al diseño azul

El 7 de noviembre de 2026 Sin Vueltas cambió del diseño azul a la paleta de Bogotá (ladrillo, amarillo de la bandera,
verde cerro, niebla y asfalto). El diseño azul quedó guardado completo en la etiqueta de git **`diseno-azul`**, que
apunta al commit `5327239`, el último publicado con ese diseño. La etiqueta también está en GitHub, así que no se
pierde aunque se borre esta carpeta.

Comparación visual de los dos diseños: `../propuestas/sin-vueltas-paleta-bogota.html` (en la carpeta `plataformas`).

## Qué archivos cambiaron con la paleta

Solo el aspecto. Las rutas, el motor y los datos no cambiaron.

- `app.css`: colores, cerros, selector de buses, botón «Rutas», etiquetas y esperas.
- `index.src.html`: logo, selector de buses con sus buses dibujados, cerros con Monserrate y el pin del mapa.
- `js/app.js`: reloj en «La más rápida», colores del mapa y del pin.
- `build.js`: color de la barra del sistema (`theme-color`) y del ícono instalado.
- `assets/icon.svg`, `assets/icon-180.png`, `assets/icon-192.png`, `assets/icon-512.png`: ícono de la app.

## Cómo volver

### Si no ha habido otros cambios después de la paleta

Deshacer el commit de la paleta (crea un commit nuevo, no borra historia):

```bash
git revert <commit-de-la-paleta>
node build.js
git push
```

El commit de la paleta es el que dice «Paleta Bogotá» en `git log --oneline`.

### Si después hubo otros cambios en esos archivos

Traer solo los archivos de aspecto desde la etiqueta y revisar a mano lo que se haya agregado después:

```bash
git checkout diseno-azul -- app.css index.src.html assets/icon.svg assets/icon-180.png assets/icon-192.png assets/icon-512.png
```

`js/app.js` y `build.js` tienen también otras cosas, así que en esos dos conviene cambiar solo las líneas de color
(se ven con `git diff diseno-azul -- js/app.js build.js`). Luego `node build.js`, probar y `git push`.

GitHub publica solo al recibir el push. La app instalada en los teléfonos se actualiza sola la próxima vez que se abra.
