# Plantilla de solicitud para Claude — tareas complejas

Esta plantilla estructura una solicitud que requiere análisis o trabajo de
complejidad media o alta, para que Claude pueda arrancar a toda velocidad
sin tener que pedir aclaraciones.

**Cuándo usarla:** diseño de una nueva funcionalidad, refactor no trivial,
investigación de bugs que tocan varios archivos, decisiones de arquitectura.
**No es necesaria** para una pregunta rápida o un arreglo de una línea.

**Secciones prioritarias** si vas corto de tiempo: 1, 2, 6, 8.

---

```markdown
# Solicitud: <título corto>

## 1. Contexto
<2-4 frases: dónde estamos, por qué surge esta solicitud ahora.
Ej.: "Acaba de salir v2.12.0. Quiero preparar el siguiente paso para las alertas ECCC Fase B."
Incluir commits / PRs / archivos ya tocados si procede.>

## 2. Objetivo
<Una frase. El resultado concreto esperado.
Ej.: "Diseñar la arquitectura para mostrar las alertas ECCC en el mapa de radar."
Si es exploratorio, decirlo: "Quiero opciones, no una implementación.">

## 3. Restricciones y no-negociables
- <Ej.: Ningún servicio externo nuevo>
- <Ej.: Debe funcionar en Bullseye 32-bit>
- <Ej.: Ninguna clave API adicional>
- <Ej.: Sin cambios en AppContext.js>

## 4. Fuera de alcance (NO hacer)
- <Ej.: No tocar el componente Settings>
- <Ej.: No refactorizar proxyCtrl.js aunque sea tentador>

## 5. Entradas / referencias
- Archivos relevantes: <ruta:línea si es posible>
- Docs: <docs/xxx.md>
- PRs / commits: <#102, 6c20f95>
- Enlaces externos: <URL spec, doc API>

## 6. Entregable esperado
<Marcar lo que aplique:>
- [ ] Análisis + recomendación (sin código)
- [ ] Plan de implementación por etapas
- [ ] Código listo para commit
- [ ] Pull request abierta
- [ ] Comparación de opciones (1/2/3 + recomendación)

Formato: <Ej.: "respuesta en francés, opciones numeradas, máx. 200 palabras por opción">

## 7. Criterios de éxito
<¿Cómo sabré que está bien?
Ej.: "El build pasa + la alerta aparece en el mapa sin parpadeo + traducciones FR/EN/ES listas.">

## 8. Nivel de autonomía
<Uno de tres:>
- 🟢 Adelante autónomo — decide y ejecuta, reviso al final
- 🟡 Plan primero — propone, yo apruebo, después ejecutas
- 🔴 Paso a paso — confirma cada sub-tarea

## 9. Notas / caminos ya explorados
<Lo que ya probaste o descartaste, para no repetir el recorrido.
Ej.: "Miré la opción WebSocket — descartada, demasiado pesada para la Pi.">
```

---

## Reglas prácticas de uso

- Las secciones **1, 2, 6, 8** son las que más rinden. Si sólo tienes
  tiempo para cuatro secciones, son esas.
- La sección **4 (fuera de alcance)** ahorra mucho tiempo: evita que
  Claude se vaya por un refactor sorpresa.
- La sección **8 (autonomía)**: omítela si aplican tus preferencias
  habituales (Claude las tiene en memoria). Rellénala explícitamente sólo
  si quieres cambiar el valor por defecto para esta solicitud.
- Para solicitudes muy pequeñas (bug de una línea, pregunta rápida),
  olvídate de la plantilla — está pensada para tareas de complejidad
  media o alta.

## Versiones

- 🇫🇷 Français — [`claude-request-template_fr.md`](claude-request-template_fr.md)
- 🇬🇧 English — [`claude-request-template_en.md`](claude-request-template_en.md)
- 🇪🇸 Español — este documento
