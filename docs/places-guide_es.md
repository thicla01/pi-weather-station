# Lugares — guardar los sitios que consulta a menudo

La lista **Lugares** le permite guardar unos cuantos sitios y pasar de
uno a otro con un solo toque. Al seleccionar uno cambia todo a la vez:
la temperatura, el pronóstico, el radar, las alertas, la calidad del
aire — y, si tiene una, la pantalla Sense HAT.

Se abre con el **icono de marcador** de la barra inferior.

> **Una sola cosa que entender, y lo demás se sigue.**
> La lista tiene dos tipos de fila. Su **ubicación de inicio** — el
> sitio que la estación muestra al encenderse — está siempre arriba,
> marcada con una casita `⌂`. Debajo están los lugares que **usted** ha
> guardado. Se parecen, pero no se comportan igual, y de esa
> distinción vienen casi todas las dudas sobre esta pantalla.

---

## Guardar un lugar

No hay campo de búsqueda. Se guarda **el sitio que está viendo en ese
momento**, lo que en una pantalla táctil es más rápido que escribir.

1. Lleve el mapa al sitio que quiera — arrastrándolo, o tocándolo.
2. Toque el **nombre de la ciudad**, arriba en la pantalla. Se abre un
   panel con los detalles de esa ubicación.
3. Al final de ese panel, toque **Anclar este lugar**.

Se añade a su lista, con un nombre puesto automáticamente a partir de
los datos del mapa (por ejemplo *Saint-Donat, Quebec*). Si el nombre no
es el que quería, puede cambiarlo — vea *Renombrar* más abajo.

Si el botón dice **Anclado**, ese sitio ya está en su lista. Si está
atenuado con *«Lista llena»*, vea *Cuántos lugares*.

## Ir a un lugar guardado

Abra **Lugares** y toque una fila. El mapa se desplaza allí y el panel
se cierra. Eso es todo — nada que confirmar, y siempre puede volver.

La fila que está viendo en ese momento lleva una barra de color en su
borde izquierdo.

## Modificar la lista — el modo Modificar

Toque **Modificar**, al final del panel Lugares. Aparecen tres botones
en cada fila:

| Botón | Qué hace |
|---|---|
| `⌂` | Convertir este sitio en su **ubicación de inicio** |
| `✎` | **Renombrarlo** |
| `✕` | **Quitarlo** de la lista |

Mientras el modo Modificar está activo, tocar una fila ya no mueve el
mapa — las filas pasan a ser editables. Toque **Hecho** al terminar.

**Quitar requiere dos toques.** El primer toque en `✕` lo convierte en
**¿Quitar?**; el segundo borra. Si espera unos cuatro segundos, o toca
otra cosa, se cancela solo. Es a propósito: no hay deshacer.

## Renombrar

En modo Modificar, toque `✎` en una fila, escriba el nuevo nombre y
pulse **Intro**. **Esc** cancela. El panel se lo recuerda debajo de la
casilla.

Los nombres son suyos — *Casa*, *La cabaña*, *Casa de mamá*. Hasta 40
caracteres.

> **Hace falta un teclado.** La estación no tiene teclado en pantalla:
> en una pantalla táctil sin nada conectado, la casilla se abre pero no
> puede escribir en ella. Toque en otro sitio y no se modifica nada.
> Conecte un teclado USB, o hágalo desde un ordenador conectado a la
> estación.

## Su ubicación de inicio

Es el sitio que la estación muestra al arrancar, y al que vuelve el
botón de **recentrar** de la barra inferior. Es la fila `⌂`, arriba
del todo.

Por defecto se deduce automáticamente de su conexión a internet, lo
que suele ser correcto a nivel de municipio.

**Para cambiarla:** abra **Lugares** → **Modificar** → toque `⌂` en la
fila que quiera. La casita se traslada allí, y el efecto es inmediato
— sin reiniciar.

**Para renombrarla:** la fila `⌂` no se renombra directamente, porque
no es realmente un lugar guardado — es un recordatorio de dónde
arranca la estación. Conviértala primero en un lugar real: en modo
Modificar, toque el `★` de la fila `⌂`. Pasa a ser una fila normal, que
puede renombrar con `✎`.

> **¿Adónde fue la fila `⌂`?** Esto sorprende. Una vez anclada su
> ubicación de inicio, *pasa a ser* uno de sus lugares guardados — así
> que la fila de recordatorio ya no hace falta y desaparece, y la
> casita se traslada a su fila guardada. No se ha perdido nada: el
> mismo sitio aparece una vez en lugar de dos.

**Para volver a automático:** en modo Modificar, toque `↺` en la fila
`⌂`. La estación vuelve a deducir su ubicación de la conexión a
internet, de inmediato. Este botón solo aparece si hay una ubicación
manual realmente guardada — si ya es automática, no hay nada que
deshacer, así que no se muestra.

> **Vaciar la lista no reinicia su ubicación de inicio.** Si quita
> todos los lugares guardados, la estación sigue arrancando donde
> usted le indicó. Es deliberado: borrar un acceso directo no debería
> mover su estación sin avisar. El `↺` de arriba es la forma de volver
> a automático.

## ¿Cuántos lugares puedo guardar?

**Seis** — o **siete** si uno de ellos es su ubicación de inicio.

La razón es el tamaño del panel: muestra siete filas en la pantalla de
7 pulgadas sin tener que desplazar, y la fila `⌂` ocupa una. Ancle su
ubicación de inicio y esa fila deja de hacer falta, lo que libera el
sitio para un lugar real.

En el límite, **Anclar este lugar** aparece atenuado con *«Lista
llena»*. Quite alguno que ya no use y vuelve a activarse.

## Desde un móvil u otro ordenador

Si abre la estación desde otro dispositivo de su red, puede **ver la
lista y tocar las filas para mover el mapa**, pero el botón
**Modificar** no está.

Es intencionado. Los cambios solo se aceptan desde la propia estación,
para que nadie más en la red pueda tocar sus ajustes. Para modificar
desde un ordenador, use la conexión segura descrita en la documentación
principal — cuenta como la propia estación.

---

## Si algo parece raro

| Lo que ve | Qué está pasando |
|---|---|
| Un lugar lleva solo el nombre de la región, como *Texas* | Los datos del mapa no tienen municipio para ese punto exacto, así que solo llegó la zona más amplia. Renómbrelo como prefiera |
| El nombre es correcto pero prefiere otro | Modificar → `✎`. Los nombres son libres |
| *«Lista llena»* en el botón de anclar | Está en el límite. Quite uno, o ancle su ubicación de inicio para liberar un sitio |
| El `✎` abre una casilla donde no se puede escribir | No hay teclado conectado — vea *Renombrar* |
| No aparece el botón **Modificar** | Está conectado desde otro dispositivo — vea más arriba |
| La fila `⌂` ha desaparecido | La ancló; la casita está ahora en su fila guardada |
| Sigue arrancando en el sitio equivocado tras borrarlo todo | La ubicación de inicio es independiente de la lista — use `↺` en la fila `⌂` |
| Tocar una fila no hace nada | El modo Modificar está activo. Toque **Hecho** primero |

Los nombres y las listas se guardan en la propia estación, no en el
navegador: sobreviven a un reinicio y se incluyen en una copia de
seguridad de los ajustes de la estación.
