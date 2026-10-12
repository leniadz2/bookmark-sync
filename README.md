# Bookmark Sync

Extensión para navegadores basados en Chromium que permite exportar los marcadores de un navegador **Publisher** e importarlos en navegadores **Subscriber** mediante un archivo JSON local y un host nativo de Python para Windows.

> **Estado:** flujo probado en el flujo Vivaldi (Publisher) → Edge (Subscriber): 316 marcadores exportados e importados, 0 omitidos. Continúa siendo una herramienta en desarrollo; realiza respaldos antes de importar en perfiles importantes.

## Principios

- **Publisher es la fuente canónica:** determina el árbol de marcadores exportado.
- **Subscriber replica:** al importar, reemplaza los marcadores existentes en las raíces compatibles.
- **Sin carpetas artificiales:** si el Subscriber carece de una raíz identificada por `folderType`, se omite y se registra en el reporte, sin crear carpetas alternativas.
- **Raíces dinámicas:** se identifican por el valor `folderType` devuelto por Chromium, sin IDs, posiciones, títulos ni equivalencias específicas de navegador.
- **Contenedores especiales excluidos:** no se exportan raíces sin `folderType`, ni tipos `trash` o `managed`, ni raíces marcadas como no modificables.
- **Sin modificar el origen:** la importación no modifica `data/bookmarks.json`.
- **Errores de URL no bloqueantes:** si el navegador rechaza un enlace, se registra y se continúa con los demás.
- **Reporte accesible:** las incidencias se escriben en `data/import-errors.txt` y pueden consultarse y descargarse desde el popup de la extensión.

La sincronización es **manual y unidireccional**: exportar en Publisher e importar en cada Subscriber. No hay sincronización automática en segundo plano, entre cuentas ni entre dispositivos móviles.

## Estructura del proyecto

```text
bookmark-sync/
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── popup.html
│   ├── popup.js
│   ├── report.html
│   ├── report.js
│   ├── icons/
│   └── scripts/
├── native/
│   ├── bookmark_host.py
│   ├── install_host.ps1
│   ├── bookmark_host.bat
│   └── native_host.example.json
├── data/                        # Local y privada; no publicar
│   ├── bookmarks.json           # Generado por Publisher
│   └── import-errors.txt        # Reporte de la última importación
├── .gitignore
└── README.md
```

Los ejecutables y archivos generados por el instalador, incluido `native/native_host.json`, deben permanecer fuera del repositorio público.

## Requisitos

- Windows.
- Un navegador Chromium compatible con extensiones Manifest V3 y Native Messaging.
- Python 3 y las dependencias de compilación que utiliza `native/install_host.ps1` (PyInstaller).
- PowerShell.
- El identificador de la extensión cargada en cada navegador donde se utilizará el host nativo.

## Instalación

1. Clona o descarga el repositorio en una carpeta local.
2. Abre la página de extensiones del navegador (`chrome://extensions`, `edge://extensions` o la correspondiente), activa **Modo de desarrollador** y selecciona **Cargar descomprimida** apuntando a `extension/`.
3. Copia el ID que el navegador asigna a la extensión.
4. Abre PowerShell en la raíz del proyecto y ejecuta:

```powershell
.\native\install_host.ps1 -ExtensionIds @("ID_DE_LA_EXTENSION")
```

Si usas la extensión en varios navegadores con IDs distintos, proporciona todos los IDs:

```powershell
.\native\install_host.ps1 -ExtensionIds @("ID_VIVALDI", "ID_EDGE")
```

5. Recarga la extensión después de instalar el host.

**Importante:** vuelve a ejecutar `install_host.ps1` **sin** `-SkipBuild` cuando cambie `native/bookmark_host.py`, para reconstruir el ejecutable. La compatibilidad de registro puede variar entre navegadores; las entradas de registro creadas por el script deben comprobarse en el equipo de destino.

## Uso

### 1. Exportar desde Publisher

1. Abre el popup de la extensión en el navegador de origen.
2. Selecciona **Publisher - Origen**.
3. Pulsa **Exportar marcadores**.
4. Comprueba que se genere `data/bookmarks.json`.

El archivo usa el formato `bookmark-sync`, **versión 2**. Las raíces se guardan en un arreglo y mantienen su `folderType` original, sin convertirlo a claves internas:

```json
{
  "format": "bookmark-sync",
  "version": 2,
  "exportedAt": "2026-10-12T00:00:00.000Z",
  "roots": [
    { "folderType": "bookmarks-bar", "children": [] },
    { "folderType": "other", "children": [] }
  ]
}
```

El ejemplo ilustra la estructura, no contiene marcadores reales. Los tipos presentes dependen de los metadatos que proporcione el navegador. En Vivaldi se comprobó que la Papelera no se incluye. Para sincronizar, genera el archivo canónico desde Publisher y conserva un respaldo local antes de reemplazar marcadores en Subscriber.

### 2. Importar en Subscriber

1. Antes de la primera prueba, exporta los favoritos actuales del navegador destino mediante su administrador de marcadores.
2. Abre el popup y selecciona **Subscriber - Réplica**.
3. Pulsa **Importar y reemplazar**.
4. Revisa el resumen de marcadores importados y omitidos.
5. Si hay incidencias, utiliza **Ver reporte de importación (TXT)** para abrir la página de reporte y descargar el archivo.

La importación exige un JSON canónico válido, descubre las raíces del destino y empareja por coincidencia exacta de `folderType`. Valida los datos y prepara los nuevos marcadores antes de reemplazar los anteriores. Las URLs rechazadas se omiten individualmente. Las raíces no disponibles se omiten y se contabilizan. Si no se pueden identificar raíces compatibles, la operación se detiene antes del reemplazo.

**Advertencia:** el proceso reemplaza los marcadores de las raíces compatibles del Subscriber. La API de marcadores de Chromium no ofrece transacciones atómicas: un fallo durante el reemplazo puede dejar cambios parciales. No se garantiza recuperación automática.

## Reporte de incidencias

El host nativo genera `data/import-errors.txt` con información sobre:

- Cantidad de marcadores preparados/importados según la etapa informada.
- Marcadores omitidos porque el Subscriber no dispone de la raíz correspondiente.
- URLs rechazadas por el navegador, con título, ubicación y motivo.

El popup muestra un enlace al reporte cuando corresponde. El enlace abre `report.html`, que solicita el contenido al host mediante Native Messaging; desde esa página puede descargarse `import-errors.txt`.

Un ejemplo de URL que puede presentar incompatibilidades es `chrome://apps/`. El JSON del Publisher la conserva aunque el Subscriber la rechace.

## Consideraciones técnicas

- **Extensión:** JavaScript, Manifest V3, API `chrome.bookmarks`, `chrome.storage.local` y `chrome.runtime.sendNativeMessage`.
- **Host:** Python, protocolo Native Messaging y almacenamiento local en JSON/TXT.
- **Nombre del host:** `com.bookmark_sync.native_host`.
- **Formato de intercambio:** `bookmark-sync`, versión `2`, con `roots` como arreglo de objetos `{ folderType, children }`.
- **Raíces:** descubrimiento de los hijos del nodo superior mediante `folderType` y correspondencia exacta entre origen y destino. Se excluyen las raíces sin tipo identificable, `trash`, `managed` y las marcadas como no modificables. No hay reglas por IDs, orden ni nombres de navegador. La compatibilidad depende de que ambos navegadores expongan metadatos compatibles.
- **Respaldo temporal:** el Subscriber guarda una instantánea en `chrome.storage.local` antes de reemplazar marcadores; no equivale a un sistema de restauración automática.
- **Reporte:** se escribe antes de la fase destructiva, por lo que las cifras del archivo describen los marcadores preparados y no garantizan que un reemplazo posterior haya terminado correctamente.

## Privacidad y Git

Los marcadores pueden contener direcciones y nombres privados. No publiques:

- `data/` (incluidos `bookmarks.json` e `import-errors.txt`).
- `native/native_host.json`, que contiene rutas absolutas locales.
- Ejecutables y artefactos de compilación (`dist/`, `build/`, `*.exe`, `*.spec`).

Comprueba el contenido antes de publicar:

```powershell
git status --short
git add -n .
git check-ignore -v data/bookmarks.json native/native_host.json
```

Asegúrate de que `.gitignore` excluya estas rutas. El archivo `native/native_host.example.json` es únicamente una plantilla pública; no debe contener rutas privadas reales.

## Estado de validación

| Función | Estado |
|---|---|
| Exportación desde Vivaldi | Verificada: 316 marcadores activos; Papelera excluida |
| JSON canónico | Verificado: `bookmarks-bar` (282), `other` (34) |
| Native Messaging en Vivaldi | Verificado |
| Importación en Edge | Reportada como completada: 316 importados, 0 omitidos |
| Reporte TXT | Enlace visible en la interfaz; contenido y descarga no revalidados en esta prueba |
| Organización visual en Edge | Pendiente de confirmación final |
| Otros navegadores Chromium | Pendiente de pruebas específicas |

## Próximos pasos

Confirmar visualmente en Edge la estructura de carpetas y algunas URLs; revisar el contenido y la descarga del reporte TXT; probar casos de raíces incompatibles y URLs rechazadas en un perfil de prueba; y validar otros navegadores Chromium antes de publicar una versión estable.
