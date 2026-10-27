# Ruma

Ruma es un proyecto nuevo de compras e inventario, pensado primero para el teléfono. Toma como referencia el flujo de recepción de inventario, pero tiene marca, navegación y una experiencia visual propias.

## Flujos del producto

- **Compra desde boleta:** tomar o seleccionar una foto, leer texto con OCR opcional, revisar proveedor, productos, códigos, cantidades y costos antes de confirmar.
- **Compra desde catálogo:** escanear un código existente o buscarlo manualmente, editar cantidad/costo de esta compra y sumar al stock.
- **Catálogo e historial:** guardar unidad, código de barras, stock, costo más reciente y los movimientos de compra.

El prototipo actual guarda la información en el navegador para que el flujo se pueda revisar sin credenciales. Esa información no se sincroniza entre dispositivos. OCR devuelve texto de apoyo, no valida automáticamente que cada línea de la boleta sea un producto correcto.

## Preparar Supabase

El esquema independiente está en `supabase/schema.sql`. Está pensado para varios negocios: cada registro pertenece a un negocio y las políticas RLS limitan el acceso a sus miembros. **No ejecutes este esquema en el proyecto Supabase de INVENTARIO.** Crea un proyecto Supabase aparte y revisa el SQL antes de aplicarlo.

Todavía falta configurar Auth, almacenamiento privado, invitaciones de miembros y conectar el cliente de esta PWA a Supabase. No pongas una clave `secret` o `service_role` en código de navegador. Usa solo la clave pública del proyecto, con RLS activado.

## Publicar en GitHub Pages

El workflow `.github/workflows/pages.yml` publica los archivos estáticos con GitHub Pages cuando se envían cambios a `main`. En GitHub, selecciona **Settings → Pages → GitHub Actions** como fuente de publicación. La cámara del teléfono solo funciona en HTTPS o en localhost.

Para probar localmente, sirve esta carpeta con un servidor estático y abre su dirección desde el teléfono.

