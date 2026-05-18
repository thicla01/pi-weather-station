# Confiar en el certificado autofirmado del Pi

Esta guía explica cómo instalar el certificado TLS del Pi como raíz de confianza en un dispositivo personal. Elimina el aviso «No seguro» del navegador y — más importante — corrige el problema del **icono PWA en la pantalla de inicio de iOS** (sin confianza, iOS rechaza la descarga en segundo plano de `apple-touch-icon` y muestra en su lugar un glifo genérico de «primera letra del título de la página»).

> **¿Por qué es necesario?**
> El Pi sirve HTTPS con un certificado autofirmado (sin autoridad certificadora externa). Los navegadores y sistemas operativos tratan los certificados autofirmados como no confiables por defecto. Para el propio navegador del Pi, el certificado es generado por el Pi y reconocido automáticamente; para cualquier otro dispositivo en la LAN (su teléfono, un portátil, una tableta), la cadena de certificación no se valida y las rutas seguras del SO de las que dependen algunas funciones (instalación PWA, service workers, notificaciones push) se niegan a operar.
>
> La solución es una instalación **única, por dispositivo** del certificado del Pi como raíz de confianza. Después, el SO trata al Pi como un origen verificado — mismo efecto que un certificado real de Let's Encrypt, sin necesidad de un dominio público.

---

## Ruta rápida: desde el panel de Ajustes de la app

La instalación más rápida. Funciona en iOS, Android, macOS, Windows y Linux:

1. En el dispositivo a configurar, abra la URL del kiosco (p. ej. `https://<ip-del-pi>:8443`) y toque **Continuar** a pesar del aviso de seguridad del navegador. (Es precisamente este aviso que esta guía elimina — pero por ahora debe aceptarlo una vez para cargar la página.)
2. Abra **Ajustes** en la app (icono de engranaje en el dock inferior).
3. Sección 1 (Preferencias locales) → desplácese hasta el bloque **«Confiar en este Pi en este dispositivo»** al final.
4. Toque **Descargar certificado**. El archivo `pi-weather-cert.pem` se guarda en su dispositivo.
5. Continúe con los pasos específicos de la plataforma a continuación.

El enlace «Descargar certificado» apunta a `/api/cert.pem` que sirve el archivo con `Content-Type: application/x-x509-ca-cert` — iOS, Android y macOS reconocen este tipo MIME y ofrecen instalar el certificado como un perfil / raíz del sistema.

---

## iOS / iPadOS (Safari + cualquier otro navegador iOS)

1. Tras descargar `pi-weather-cert.pem`, iOS muestra una notificación: **«Perfil descargado»**. Tóquela.
   - Si la perdió: **Ajustes → General → VPN y gestión de dispositivos → Perfil descargado**.
2. Toque **Instalar** en la esquina superior derecha. Ingrese el código del dispositivo.
3. Confirme cualquier advertencia de «este perfil no está firmado por una AC reconocida» — ese es el punto (el Pi es la AC).
4. **Ajustes → General → Información → Ajustes de confianza de certificados**.
5. Busque la entrada para su Pi (con el nombre de host del Pi o `localhost`) y **active el interruptor**.
6. Confirme el diálogo de «Advertencia». Listo.

Una vez activada la confianza:

- Recargue la URL del kiosco en Safari — el aviso «No seguro» desapareció.
- Elimine el icono existente en la pantalla de inicio (mantener pulsado → Eliminar Web Clip).
- Añádalo de nuevo a la pantalla de inicio (Compartir → Añadir a pantalla de inicio).
- El icono del radar ahora se muestra correctamente en lugar de la «P».

**Nota un-certificado-por-Pi:** el certificado del Pi se genera con la dirección IP LAN y el nombre de host del Pi en su Subject Alternative Name (SAN). Si tiene varios Pi, repita los pasos una vez por Pi. No hay AC central — cada Pi es su propia raíz.

---

## Android (Chrome / Firefox / Samsung Internet)

El flujo de instalación de AC en Android está más restringido que en iOS — lo que funciona depende de la versión de Android y la capa del fabricante.

### Android 14+ (Pixel / Android stock)

1. Tras la descarga, abra **Ajustes → Seguridad → Más ajustes de seguridad → Cifrado y credenciales → Instalar un certificado → Certificado de autoridad certificadora**.
2. Toque **Instalar de todos modos** en el aviso sobre AC que reducen la seguridad.
3. Seleccione el archivo `pi-weather-cert.pem` descargado.
4. Confirme el nombre del certificado e **Instalar**.

> Nota: en Android 7+ las apps deben optar explícitamente por las AC añadidas por el usuario mediante su configuración de seguridad de red. Chrome y Firefox lo hacen; algunas apps no. Para nuestro caso de uso (instalación PWA via navegador), el opt-in de Chrome es lo que importa.

### Android 11-13

Misma ruta que Android 14+, pero el menú está en **Ajustes → Biometría y seguridad → Otros ajustes de seguridad → Instalar desde almacenamiento del dispositivo → Certificado de AC**.

### Samsung One UI

La ruta de instalación de AC es **Ajustes → Biometría y seguridad → Otros ajustes de seguridad → Instalar desde almacenamiento del dispositivo**, pero en las versiones recientes de One UI la opción aparece como **«Certificado de usuario VPN y apps»** o **«Certificado Wi-Fi»** según el uso previsto. Elija la ruta que termine en **«Certificado de AC»**.

Tras la instalación:

- Recargue Chrome → aviso «No seguro» desapareció.
- El aviso de instalación PWA aparece en la barra de URL.
- Instalar → el icono del radar aparece en la pantalla de inicio.

---

## macOS (Acceso a Llaveros)

1. Doble clic en el `pi-weather-cert.pem` descargado — **Acceso a Llaveros** se abre.
2. Confirme la adición al llavero **Sistema** (o **inicio de sesión**, si solo lo quiere confiable para su usuario).
3. Busque el certificado en la lista. Lleva el nombre de host del Pi o `localhost`.
4. Doble clic. En la sección **Confianza**, establezca **«Al usar este certificado»** en **«Confiar siempre»**.
5. Cierre la ventana — macOS pedirá su contraseña para actualizar el ajuste de confianza.

Después: Safari y Chrome ya no muestran avisos para el Pi.

---

## Windows (Edge / Chrome / Firefox)

Edge y Chrome usan el almacén de certificados de Windows; Firefox tiene su propio almacén y necesita un paso aparte.

### Edge / Chrome / IE

1. Doble clic en el `pi-weather-cert.pem` descargado.
2. Haga clic en **Instalar certificado**.
3. Elija **Equipo local** (a nivel de sistema) o **Usuario actual** (solo para usted). Clic en **Siguiente**.
4. Elija **«Colocar todos los certificados en el siguiente almacén»** → **Examinar** → seleccione **«Entidades de certificación raíz de confianza»** → **Aceptar** → **Siguiente** → **Finalizar**.
5. Confirme el aviso de seguridad.

### Firefox

Firefox tiene su propio almacén de confianza independiente de Windows.

1. **Preferencias → Privacidad y seguridad → Certificados → Ver certificados**.
2. Pestaña **Autoridades** → **Importar**.
3. Seleccione `pi-weather-cert.pem`.
4. Marque **«Confiar en esta CA para identificar sitios web»**. Clic en **Aceptar**.

---

## Linux desktop (Chrome / Firefox)

La mayoría de los navegadores de escritorio en Linux usan la base NSS compartida en `~/.pki/nssdb`. La herramienta `certutil` del paquete `libnss3-tools` (Debian/Ubuntu) o `nss-tools` (Fedora) es la manera más sencilla de añadir un certificado:

```bash
sudo apt install libnss3-tools     # Debian / Ubuntu
sudo dnf install nss-tools         # Fedora / RHEL

certutil -A -n "Pi Weather Station" \
  -t "C,," \
  -i pi-weather-cert.pem \
  -d sql:$HOME/.pki/nssdb
```

Firefox tiene su propia base; o use la interfaz de Firefox (ver la sección Windows arriba), o pase `-d sql:$HOME/.mozilla/firefox/<perfil>/`.

---

## Cuándo repetir esta operación

El certificado del Pi se genera con un período de validez de **825 días**. El kiosco lo regenera automáticamente cuando está a menos de 30 días de la expiración o cuando cambia la configuración LAN (p. ej. nueva IP estática asignada al Pi). Cualquiera de estos eventos invalida el perfil de confianza anterior, y deberá repetir el flujo de instalación una vez por dispositivo.

No hay sincronización automática de renovación porque el Pi es toda la cadena de confianza — sin AC externa de donde obtener actualizaciones. La ventana de 825 días es suficientemente larga como para que sea «set and forget» en la mayoría de las instalaciones.

---

## ¿Y si simplemente no quiero el problema del icono?

El icono de respaldo «P sobre fondo negro» es puramente cosmético. La app en sí funciona exactamente igual — mismos datos, mismos controles, mismo modo PWA standalone si la instala. Si el icono no le importa y quiere saltarse la instalación del certificado, es una opción válida. Lo único que se perderá es el glifo del radar en la pantalla de inicio.
