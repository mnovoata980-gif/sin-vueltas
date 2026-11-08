# Carta a la Secretaría de Movilidad: los 108 puntos sin vehículos eléctricos

Para radicar en **Bogotá te escucha** (bogota.gov.co/sdqs), entidad Secretaría Distrital de Movilidad, o en sus canales de atención. Llena lo que está entre corchetes antes de enviarla. La respuesta debe llegar en 15 días hábiles (10 si se trata como solicitud de información).

Por qué hace falta: desde julio de 2025 la Secretaría dice que prohíbe los vehículos eléctricos livianos en 108 puntos críticos de ciclorruta de 14 localidades, con señales en la vía, pero la lista no está en datos abiertos ni en ningún comunicado. Sin ella, el modo Eléctrico de Sin Vueltas puede sugerir un tramo donde una patineta o una bici eléctrica tiene prohibido pasar. Cuando llegue la lista, cada tramo se agrega en `data/bike-rules.json` (campo `closed`) y se corre `node tools/build-bike.js`.

---

Bogotá D.C., [fecha]

Señores
**Secretaría Distrital de Movilidad**
Ciudad

**Asunto:** Derecho de petición de información. Tramos de cicloinfraestructura donde está prohibida la circulación de vehículos eléctricos livianos.

Yo, [nombre completo], identificado con cédula de ciudadanía [número], en ejercicio del derecho de petición del artículo 23 de la Constitución Política y de la Ley 1755 de 2015, presento la siguiente solicitud.

**Contexto**

Estoy desarrollando *Sin Vueltas*, una aplicación web gratuita, sin publicidad y sin cuentas de usuario, que sugiere rutas en Bogotá según el vehículo de cada persona: bicicleta, bicicleta eléctrica, patineta eléctrica, ciclomotor o motocicleta. La aplicación solo sugiere vías por las que cada vehículo puede circular según la Ley 2486 de 2025 y la Resolución 20263040030675 de 2026 del Ministerio de Transporte, y advierte que la señalización en la vía prevalece sobre la ruta sugerida.

El 18 de julio de 2025 la Secretaría informó que, con base en el numeral 5 del artículo 96-1 de la Ley 769 de 2002 (adicionado por la Ley 2486 de 2025), restringe la circulación de vehículos eléctricos livianos en 108 puntos críticos de 14 localidades. No encontré esa lista en el portal de datos abiertos de Bogotá ni en los comunicados de la entidad.

**Peticiones**

1. Entregar la lista de los tramos o puntos de cicloinfraestructura donde está prohibida o restringida la circulación de vehículos eléctricos livianos de movilidad personal urbana, con su ubicación (dirección o coordenadas), la localidad y el tipo de vehículo al que aplica.
2. Indicar el acto administrativo que establece cada restricción y su fecha.
3. Informar si la restricción aplica también a bicicletas de pedaleo asistido o solo a otros vehículos eléctricos livianos.
4. Informar si la Secretaría tiene previsto publicar esta información como datos abiertos y con qué frecuencia la actualizará.
5. Informar si hay tramos de cicloinfraestructura cerrados temporalmente por obras, y dónde se publican.

**Fundamentos**

- Artículo 23 de la Constitución Política y Ley 1755 de 2015.
- Ley 1712 de 2014 (transparencia y acceso a la información pública), artículos 4 y 9.
- Ley 2486 de 2025, artículo 3 (artículo 96-1, numeral 5, de la Ley 769 de 2002).
- Resolución 20263040030675 de 2026 del Ministerio de Transporte, artículo 5.16.1.5, parágrafo: las restricciones deben estar motivadas y delimitarse por tramo, horario o evento.

**Formato de entrega**

De ser posible, en un archivo abierto (GeoJSON, Shapefile, CSV o Excel con coordenadas). Si no, en el formato en que la entidad tenga la información.

**Notificaciones**

Correo electrónico: [correo]
Teléfono: [teléfono]

Atentamente,

[nombre completo]
C.C. [número]
