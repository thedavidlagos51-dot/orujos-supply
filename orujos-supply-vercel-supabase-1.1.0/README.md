# Orujos Supply 1.1

Aplicación de solicitudes internas preparada para **Vercel + Supabase**. Los encargados registran existencia y cantidad solicitada; el encargado de compras administra el catálogo, revisa las solicitudes y descarga Excel/PDF.

## Puesta en marcha

1. En Supabase, abra **SQL Editor**, pegue y ejecute `supabase/schema.sql`.
2. En **Authentication > Users**, cree el usuario del encargado de compras. Ejecute el último `insert` comentado del SQL, sustituyendo el correo, para convertirlo en `ADMIN`.
3. Cree cada encargado en Authentication y agregue su perfil: `role = USER`, con sucursal y área asignadas.
4. Copie `public/config.example.js` a `public/config.js` y complete la URL y clave *publishable* del proyecto. No use ni guarde la clave `service_role`.
5. Suba el contenido a GitHub. En Vercel importe el repositorio: no requiere variables de entorno ni comando de build; el directorio publicado es `public`.

## Notas de seguridad

- La clave publishable puede estar en el navegador; los permisos reales se aplican mediante las políticas RLS de Supabase.
- Un usuario normal solamente puede leer sus solicitudes y crear solicitudes para su sucursal/área asignadas.
- Solamente `ADMIN` puede editar catálogo, ver solicitudes globales, modificar estados y descargar archivos.
- Las nuevas solicitudes crean una notificación interna destinada exclusivamente a los perfiles `ADMIN`.

Las exportaciones Excel y PDF se generan localmente desde la pantalla administrativa. Para enviar correos automáticos se requiere añadir un proveedor de correo y una Supabase Edge Function.
