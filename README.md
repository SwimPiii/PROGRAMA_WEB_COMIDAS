# La mesa · Programa web de comidas

Aplicación web adaptable a móviles para organizar comidas y cenas, guardar recetas, planificar semanas y preparar la compra. Los datos se guardan en Google Drive con autenticación OAuth en el navegador y un JSON principal.

## Guardado en Drive

- Cuenta: al conectar Drive, selecciona la cuenta Google que tiene acceso a la carpeta.
- Carpeta: `PROGRAMA_WEB_COMIDAS`.
- Folder ID configurado: `1dEk--6BKJdkxGUeuGiP3MncgjTUvMdTI`.
- Datos: `comidas_semana_db.json`.
- Copias: guardadas en subcarpetas de año/mes, por ejemplo `PROGRAMA_WEB_COMIDAS/2026/09/`.
- Retención: cinco copias más recientes en total, con un único manifiesto en la raíz. Las copias anteriores que estén en la raíz se trasladan a sus carpetas fechadas; las que excedan el límite se eliminan durante el siguiente guardado.
- La app requiere conexión a internet y autorización de Drive antes de sincronizar. Los cambios quedan pendientes en memoria hasta pulsar **Guardar**. Al intentar cerrar la página con cambios pendientes, el navegador advierte que se pueden perder: no se intenta guardar de forma asíncrona durante el cierre porque el navegador no garantiza que una petición a Drive finalice. El modo de prueba persiste localmente solo al pulsar **Guardar**. No hay fusión de cambios simultáneos; si se usa en dos dispositivos a la vez, conviene recargar antes de editar desde el segundo.

## Requisitos de Google OAuth

La app utiliza un Client ID web público propio; no incluye Client Secret. En Google Cloud deben estar habilitados Google Drive API, la pantalla de consentimiento y el origen web desde el que se publique/abra la app. Autoriza `https://swimpiii.github.io` para GitHub Pages y `http://localhost:5512` para la prueba local. El primer acceso solicita permiso de Drive.

La cuenta de Google que autorice debe tener acceso a la carpeta indicada. Si el proyecto OAuth sigue en modo de prueba, añade cada cuenta autorizada en la lista de usuarios de prueba.

## Ejecutar en local

Desde esta carpeta, inicia un servidor estático con Python:

```powershell
python -m http.server 5512
```

Abre `http://localhost:5512/` en el navegador. No abras `index.html` directamente como archivo: OAuth necesita un origen HTTP/HTTPS.

## Publicar en GitHub Pages

El workflow `.github/workflows/pages.yml` publica este directorio automáticamente en GitHub Pages cada vez que se sube un cambio a la rama `main`. Al crear el repositorio, selecciona `main` como rama predeterminada; después, en **Settings → Pages**, configura **Build and deployment → Source: GitHub Actions**. La URL tendrá el formato `https://USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/`.

En el cliente OAuth de este proyecto de Google Cloud, añade como origen autorizado `https://USUARIO.github.io` (solo el origen, sin el nombre del repositorio ni la barra final). Conserva también `http://localhost:5512` para probar en este ordenador.

**Privacidad:** un sitio servido en GitHub Pages puede ser accesible públicamente. No guardes secretos ni datos personales en este repositorio. Las recetas y planes de esta app están en el JSON de Google Drive del usuario que autoriza el acceso; no se publican con el sitio.

## Uso

1. Para probar sin Drive, pulsa **Probar sin Drive**. El modo de prueba guarda los datos en el almacenamiento local de este navegador y puedes retomarlo al volver a abrir la app en el mismo navegador. Estos datos no se sincronizan con Drive ni aparecen en otros dispositivos.
2. Para guardar en la nube, conecta Google Drive y autoriza el acceso.
3. En **Listado platos**, guarda cada plato como comida o cena; añade ingredientes con cantidad en gramos y, opcionalmente, etiquetas de exclusión separadas por comas.
4. En **Planificación**, recorre semanas, sortea de lunes a viernes y cambia cualquier plato con los selectores. Sábado y domingo se rellenan manualmente.
5. En **Cesta de la compra**, revisa los ingredientes sumados de los siete días, marca lo que ya tienes y añade productos domésticos.

El sorteo no repite platos durante la semana e impide coincidencias de etiquetas de exclusión en el mismo día. Si no existe una combinación válida para todas las comidas y cenas, no reemplaza la semana y explica que faltan platos compatibles.
