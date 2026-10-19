# Lista Compra

Lista de la compra compartida para casa. Cada persona de la familia entra con su correo, añade o quita productos (con cantidad) y todos ven la misma lista al momento.

- **Lista**: lo que hace falta en casa. Desplegable con los 10 últimos productos y botones con los 10 más frecuentes (recuerdan la última cantidad usada).
- **Hacer compra**: mueve la lista a la pestaña **Compra** y la deja vacía.
- **Compra**: vas marcando lo que metes en el carro. Al pulsar **Terminar compra**, lo no marcado vuelve a la lista.

Es una web estática (HTML, CSS y JavaScript, sin build). Se publica en **Vercel** y guarda los datos en **Supabase**.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La página |
| `styles.css` | El diseño |
| `app.js` | La lógica y la conexión con Supabase |
| `config.js` | **Lo único que tienes que editar**: URL y clave pública de Supabase |
| `supabase/schema.sql` | Tablas, seguridad y funciones de la base de datos |
| `manifest.webmanifest`, `icon.svg` | Para poder "Añadir a pantalla de inicio" en el móvil |

---

## Puesta en marcha

### 1. Crear la base de datos en Supabase

1. Entra en [supabase.com](https://supabase.com), crea una cuenta y pulsa **New project**. Elige una región de Europa.
2. Cuando esté listo, ve a **SQL Editor → New query**, pega todo el contenido de `supabase/schema.sql` y pulsa **Run**.
3. En una consulta nueva, añade los correos de la familia y pulsa **Run**:

   ```sql
   insert into public.miembros (email) values
     ('tu-correo@gmail.com'),
     ('correo-de-otro-familiar@gmail.com')
   on conflict do nothing;
   ```

   Solo esos correos podrán ver y modificar la lista. Para añadir a alguien más adelante, repite este paso con su correo.

### 2. Conectar la web con Supabase

1. En Supabase ve a **Project Settings → API** (en algunos proyectos se llama **Data API** o **API Keys**).
2. Copia la **Project URL** y la clave **anon public** (en proyectos nuevos puede llamarse **publishable key**).
3. Edita `config.js` en GitHub (icono del lápiz) y pega los dos valores:

   ```js
   window.CONFIG = {
     SUPABASE_URL: 'https://abcdefgh.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbGciOi...'
   };
   ```

   Esa clave está pensada para ir en la web: lo que protege los datos es la seguridad de la base de datos. **No pongas nunca la clave `service_role`.**

### 3. Publicar en Vercel

1. Entra en [vercel.com](https://vercel.com) con tu cuenta de GitHub.
2. **Add New → Project**, elige el repositorio `lista-compra` y pulsa **Import**.
3. En *Framework Preset* deja **Other**. No hace falta comando de build ni carpeta de salida.
4. Pulsa **Deploy**. Te dará una dirección del tipo `https://lista-compra-xxxx.vercel.app`.

Cada vez que cambies algo en GitHub, Vercel publica la nueva versión solo.

### 4. Permitir el inicio de sesión desde tu web

En Supabase, ve a **Authentication → URL Configuration**:

- **Site URL**: tu dirección de Vercel, por ejemplo `https://lista-compra-xxxx.vercel.app`
- **Redirect URLs**: añade `https://lista-compra-xxxx.vercel.app/**`

Sin este paso, el enlace del correo no lleva de vuelta a la lista.

### 5. Usarla

1. Abre tu dirección de Vercel, escribe tu correo y pulsa **Enviar enlace**.
2. Abre el correo **en el mismo dispositivo** y pulsa el enlace. Ya estás dentro; la sesión se queda guardada.
3. Comparte la dirección con la familia. Cada uno entra con su propio correo (tiene que estar en la tabla `miembros`).
4. En el móvil: menú del navegador → **Añadir a pantalla de inicio** para tenerla como una app.

---

## Notas

- **Correos de acceso**: Supabase envía los enlaces con su servidor de correo de pruebas, que tiene un límite bajo de envíos por hora. Para una familia sobra, porque la sesión se queda abierta. Si algún día se queda corto, en **Authentication → Emails → SMTP Settings** puedes poner tu propio servidor de correo.
- **Probar en tu ordenador**: desde la carpeta del proyecto, ejecuta `npx serve .` y abre `http://localhost:3000`. Añade también `http://localhost:3000/**` en las *Redirect URLs* de Supabase.
- **Quitar a alguien**: borra su fila en **Table Editor → miembros**.
- **Plan gratuito de Supabase**: los proyectos sin actividad durante una semana se pausan. Se reactivan desde el panel de Supabase con un clic.
