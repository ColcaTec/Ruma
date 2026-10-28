# Ruma

Ruma es un proyecto nuevo de compras e inventario, pensado primero para el teléfono. Toma como referencia el flujo de recepción de inventario, pero tiene marca, navegación y una experiencia visual propias.

## Flujos del producto

- **Compra desde boleta:** tomar o seleccionar una foto, mejorar el contraste para OCR, sugerir el proveedor y proponer líneas con cantidades y costos cuando el formato es reconocible; revisar todo antes de confirmar.
- **Compra desde catálogo:** escanear un código existente o buscarlo manualmente, editar cantidad/costo de esta compra y sumar al stock.
- **Catálogo e historial:** guardar unidad, código de barras, stock, costo más reciente y los movimientos de compra.

La lectura OCR es una sugerencia heurística, no una garantía: los formatos de boleta varían y la foto debe estar enfocada, con buena luz y completa. El texto reconocido queda disponible para revisar. Confirma o corrige proveedor, productos, cantidad y costo antes de guardar.

La app requiere una cuenta con correo y contraseña. El catálogo y las compras se sincronizan con la nube y pueden abrirse desde otros dispositivos al iniciar sesión con la misma cuenta. Si encuentra datos antiguos guardados en el teléfono, ofrece importarlos a la cuenta; no reemplaza un inventario que ya exista en la nube.

## Preparar Supabase

El esquema de Ruma está en `supabase/schema.sql` y ya fue aplicado a un proyecto Supabase independiente, en la región de Sudamérica. **No ejecutes este esquema en el proyecto Supabase de INVENTARIO.** Cada cuenta recibe un espacio propio y las políticas RLS limitan el acceso a sus miembros. Las escrituras usan una revisión para detectar cambios simultáneos desde más de un dispositivo.

El cliente incluye únicamente la clave publicable de Supabase, diseñada para uso desde navegador; la protección de datos la aplican las políticas RLS. Nunca pongas una clave `secret` o `service_role` en archivos públicos.

## Publicar en GitHub Pages

El workflow `.github/workflows/pages.yml` publica los archivos estáticos con GitHub Pages cuando se envían cambios a `main`. En GitHub, selecciona **Settings → Pages → GitHub Actions** como fuente de publicación. La cámara del teléfono solo funciona en HTTPS o en localhost.

Para probar localmente, sirve esta carpeta con un servidor estático y abre su dirección desde el teléfono.

