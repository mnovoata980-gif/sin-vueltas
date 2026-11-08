# Modo Bici y Eléctrico

Construido el 8 de noviembre de 2026 a partir del análisis `sin-vueltas-contexto.md`. Cubre las etapas 1 y 2 de ese documento (bici con preferencia por ciclorruta, y vehículos eléctricos con reglas) y parte de la 4 (ciclovía dominical).

## Qué hace

- Arriba se elige **Bus**, **Bici** o **Eléctrico**. El buscador, el mapa, los lugares guardados y el botón de invertir el viaje son los mismos de siempre.
- **Bici**: bicicleta o bici eléctrica de pedaleo asistido. **Eléctrico**: patineta (vehículo de movilidad personal), bici-moto o ciclomotor, moto eléctrica. «¿Cuál es el mío?» explica cómo reconocer cada uno según la norma.
- La ruta va solo por donde ese vehículo puede circular, prefiere ciclorrutas y calles tranquilas, y dice en palabras dónde no hay ciclorruta («500 m sin ciclorruta por la Avenida Carrera 15: ve por el carril derecho»).
- Para bici y patineta muestra dos opciones cuando difieren de verdad: **Más ciclorruta** y **Más directa**.
- Paso a paso con giros y la velocidad máxima de cada tramo (25 km/h en ciclorruta para eléctricos, 40 en calzada para patinetas, 45 para ciclomotores, el límite de la vía para motos).
- Domingos y festivos de 7:00 a. m. a 2:00 p. m. la bici aprovecha la ciclovía y la moto la evita.
- Compara con el mismo viaje en TransMilenio o SITP.
- Modo viaje: anuncia el próximo giro con distancia y voz, avisa si te sales de la ruta y permite recalcular.
- En el mapa se ve la red de ciclorrutas alrededor de la ruta.

## La norma, por vehículo

Revisada contra los textos oficiales: Ley 2486 de 2025 (artículo 3, que agrega el 96-1 al Código de Tránsito, y artículo 15) y Resolución 20263040030675 del 4 de agosto de 2026 del Ministerio de Transporte (Anexo 80 y artículos 5.16.1.3 a 5.16.1.6). El PDF de la resolución está escaneado; se leyó página por página.

| Vehículo | Ciclorruta | Calzada | Andén | Carril TransMilenio |
| --- | --- | --- | --- | --- |
| Bicicleta | Sí | Sí, por la derecha | No (se camina) | No |
| Bici eléctrica (pedaleo asistido, sin acelerador, corta a 25 km/h) | Sí, máx. 25 km/h | Sí, máx. 40 km/h | No | No |
| Patineta o VMP (hasta 1.000 W y 40 km/h, sin sillín) | Sí, máx. 25 km/h, obligatoria si existe y está en buen estado | Sí, carril derecho, máx. 40 km/h | No | No |
| Bici-moto o ciclomotor (con acelerador, o asiento, o más de 1.000 W; hasta 45 km/h) | **No** | Sí | No | No |
| Moto eléctrica (más de 45 km/h o 4.000 W) | **No** | Sí | No | No |

Lo que más confunde: para la norma, una «moto eléctrica» con asiento o acelerador es un ciclomotor (clase L1e) aunque tenga pedales, y **no puede usar ciclorrutas**. Una bici con acelerador tampoco es bici eléctrica. Ningún vehículo eléctrico puede rodar por andenes.

Bogotá prohíbe además los vehículos eléctricos livianos en 108 puntos de ciclorruta de 14 localidades, con señal en la vía. La lista no es pública: se pide con `docs/carta-puntos-restringidos.md`. Cuando llegue, cada tramo va en `data/bike-rules.json` (`closed`) y se corre `node tools/build-bike.js`.

## Datos

| Fuente | Qué aporta | Licencia |
| --- | --- | --- |
| OpenStreetMap (Overpass, área «Bogotá ciudad») | Calles, sentidos, ciclorrutas, senderos, límites de velocidad | ODbL |
| IDU, Red de Biciusuarios (IDECA, servicio REST, actualización trimestral) | 696 km de red oficial por clase: ciclorruta, bicicarril, carril bus-bici, espacio compartido, vía compartida, cruces | CC BY 4.0 |
| IDRD, Ciclovía | 16 tramos con horario | CC BY 4.0 |
| IDECA, cicloparqueaderos de TransMilenio | 16 estaciones con cupos (guardados en los datos, aún no se muestran) | CC BY 4.0 |

Cruce (8 de noviembre de 2026): el 91,4 % de la red oficial del IDU coincide con OpenStreetMap; 7,8 km de ciclorruta oficial que OpenStreetMap no tiene se asignan a la vía de al lado. Resultado: 108.869 cruces, 151.614 tramos, 996 km con infraestructura para bici, 244 km de ciclovía. `data/bike.json` pesa 4,1 MB (1,2 MB comprimido) y se baja solo la primera vez que alguien elige Bici o Eléctrico (en modo ligero, pregunta antes); después funciona sin internet.

## Cómo decide la ruta

- A* sobre el grafo de calles, en el teléfono (en un Web Worker). Cada ruta tarda menos de 30 ms en un computador.
- Costo = tiempo × qué tan cómoda y segura es la vía: ciclorruta 0,78, bicicarril 0,9, calle residencial 1, terciaria 1,22, secundaria 1,5, principal 1,9, troncal 2,4. Para eléctricos livianos, las calles sin ciclorruta pesan 12 % más (la ley los manda a la cicloinfraestructura). «Más directa» reduce esas diferencias al 30 %.
- Velocidades: bici 15 km/h, bici eléctrica y patineta 20 km/h, menos en avenidas sin ciclorruta, senderos con peatones y superficies sin pavimentar. Motos y ciclomotores según el tipo de vía y su límite. A pie con el vehículo, 4,5 km/h.
- Contravía: en bici o patineta se camina con el vehículo, nunca se rueda.
- La ruta empieza y termina en la parte de la red donde cada punto llega a todos los demás (componente fuertemente conexo por vehículo), para no quedar atrapada en una calle de un solo sentido sin salida.

## Límites conocidos

- Sin subidas: los tiempos no tienen en cuenta las pendientes de los cerros, Ciudad Bolívar, Usme o San Cristóbal.
- Sin tráfico en vivo, obras ni cierres temporales de ciclorrutas.
- OpenStreetMap puede tener sentidos o permisos desactualizados; la señal en la vía manda.
- Los 108 puntos prohibidos a eléctricos aún no se evitan.
- No se ha probado en la calle ni en teléfonos reales.

## Probar

```bash
node tools/test-bike.js
```

Recorre 7 viajes reales con los 5 vehículos y revisa que un ciclomotor o una moto nunca usen ciclorruta, andén ni sendero; que la bici eléctrica y la patineta nunca rueden por andenes; que la ruta segura use más ciclorruta que la directa; que la moto evite la ciclovía el domingo, y que cada ruta tarde menos de 1,5 s.
