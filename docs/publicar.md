# Cómo publicar Sin Vueltas

La app se publica gratis en GitHub Pages, y una tarea de GitHub Actions la actualiza cada día con el archivo nuevo de TransMilenio (`.github/workflows/update.yml`, a las 10:30 UTC, o sea 5:30 a. m. en Bogotá).

## Lo que necesita tu decisión

1. **Una cuenta de GitHub.** La creas tú: Claude no puede crear cuentas ni escribir contraseñas.
2. **El nombre del repositorio.** Por ejemplo `sin-vueltas`. Para que Pages sea gratis, el repositorio debe ser público: cualquiera podrá ver el código y `config.json`.
3. **`config.json`**, con estos datos:
   - `owner`: tu nombre, que aparece como responsable en la hoja de privacidad.
   - `contact`: el correo para consultas de datos personales (Ley 1581).
   - `reportEmail` o `reportForm`: a dónde llegan los reportes de error. Puede ser un correo creado solo para esto o un formulario de Google. Si los dos quedan vacíos, la app ofrece copiar el reporte.

## Pasos

1. Inicia sesión en GitHub en el navegador.
2. Crea un repositorio público vacío, sin README.
3. Sube el código desde esta carpeta:
   ```bash
   git init -b main
   git add .
   git commit -m "Sin Vueltas"
   git remote add origin https://github.com/<usuario>/<repositorio>.git
   git push -u origin main
   ```
   Al hacer `push`, Windows abre una ventana para que inicies sesión en GitHub.
4. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. En **Actions**, la tarea «Actualizar rutas» corre sola con el `push`. Cuando termine, la app queda en `https://<usuario>.github.io/<repositorio>/`.

## Qué revisar después de publicar

- Que la app abra en el teléfono y pida la ubicación. GPS, voz y avisos solo funcionan en la versión publicada, no en la vista previa.
- Que la tarea diaria termine en verde. Si un día falla (por ejemplo, con un archivo recortado de festivo), GitHub te envía un correo y la app sigue con las rutas anteriores.
- Que se pueda instalar en la pantalla de inicio.
