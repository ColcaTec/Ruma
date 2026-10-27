# Ruma

Ruma es un proyecto nuevo de compras e inventario, pensado primero para el teléfono. Toma como referencia el flujo de recepción de inventario, pero tiene marca, navegación y una experiencia visual propias.

## Flujos del producto

- **Compra desde boleta:** tomar o seleccionar una foto, mejorar el contraste para OCR, sugerir el proveedor y proponer líneas con cantidades y costos cuando el formato es reconocible; revisar todo antes de confirmar.
- **Compra desde catálogo:** escanear un código existente o buscarlo manualmente, editar cantidad/costo de esta compra y sumar al stock.
- **Catálogo e historial:** guardar unidad, código de barras, stock, costo más reciente y los movimientos de compra.

La lectura OCR es una sugerencia heurística, no una garantía: los formatos de boleta varían y la foto debe estar enfocada, con buena luz y completa. El texto reconocido queda disponible para revisar. Confirma o corrige proveedor, productos, cantidad y costo antes de guardar.

La app guarda la información en el navegador para que el flujo se pueda revisar sin credenciales. Esa información no se sincroniza entre dispositivos.

## Preparar Supabase

El esquema independiente está en `supabase/schema.sql`. Está pensado para varios negocios: cada registro pertenece a un negocio y las políticas RLS limitan el acceso a sus miembros. **No ejecutes este esquema en el proyecto Supabase de INVENTARIO.** Crea un proyecto Supabase aparte y revisa el SQL antes de aplicarlo.

Todavía falta configurar Auth, almacenamiento privado, invitaciones de miembros y conectar el cliente de esta PWA a Supabase. No pongas una clave `secret` o `service_role` en código de navegador. Usa solo la clave pública del proyecto, con RLS activado.

## Publicar en GitHub Pages

El workflow `.github/workflows/pages.yml` publica los archivos estáticos con GitHub Pages cuando se envían cambios a `main`. En GitHub, selecciona **Settings → Pages → GitHub Actions** como fuente de publicación. La cámara del teléfono solo funciona en HTTPS o en localhost.

Para probar localmente, sirve esta carpeta con un servidor estático y abre su dirección desde el teléfono.

