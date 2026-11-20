# Despliegue — El Juego del Dinero (18puro.com)

Pasos exactos. El código ya está listo y probado en local; estos pasos
requieren las cuentas de Georges (GitHub, Render, IONOS) y los hace el
agente principal con el navegador, como se hizo con la app Reaviva.

## 1. GitHub — crear el repositorio

1. Entrar en GitHub como `rebecageorges2005-eng` (la misma cuenta de la
   app Reaviva).
2. Crear repositorio público nuevo: **`el-juego-del-dinero-blog`**.
3. Subir el contenido de `~/workspace/el-juego-del-dinero-blog/` **excepto**:
   `node_modules/`, `*.db`, `.env` y `PUBLISH_KEY.txt` (el `.gitignore`
   ya los excluye — verificar antes de subir).
4. Confirmar que el repo contiene `server.js`, `package.json`,
   `render.yaml`, `public/` y `README.md`.

## 2. Turso — base de datos (gratis)

Reutilizar el patrón de la app Reaviva:

1. En el panel de Turso, crear una base de datos nueva: **`el-juego-del-dinero`**
   (o reutilizar la base `reaviva` — NO recomendado: mezclaría los datos).
2. Copiar su URL (`libsql://...`) y el auth token.

## 3. Render — crear el servicio web

1. En [dashboard.render.com](https://dashboard.render.com), **New → Web Service**,
   conectar el repositorio `el-juego-del-dinero-blog`.
2. Configuración: **Node**, plan **Free**, Build Command `npm install`,
   Start Command `node server.js`.
   (O usar el Blueprint: New → Blueprint, conectar el repo — `render.yaml`
   ya trae todo, salvo los secretos.)
3. Variables de entorno (Environment → Add Environment Variable):

   | Variable | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `TRUST_PROXY` | `true` |
   | `SITE_URL` | `https://18puro.com` |
   | `TURSO_DATABASE_URL` | URL de Turso del paso 2 |
   | `TURSO_AUTH_TOKEN` | token de Turso del paso 2 |
   | `JWT_SECRET` | generar uno aleatorio largo (48+ caracteres hex) |
   | `ADMIN_USER` | `admin` |
   | `ADMIN_PASSWORD_HASH` | hash bcrypt de la contraseña que elija Georges (ver abajo) |
   | `PUBLISH_KEY` | la clave ya generada en `PUBLISH_KEY.txt` (chmod 600, en el workspace) |

4. Desplegar y esperar a que el servicio esté en verde.
   Verificar: `https://<servicio>.onrender.com/api/health` → `{"ok":true,...}`
   y la portada debe decir "Próximamente" (blog vacío, sin artículos).

### Contraseña del admin (Georges)

- Georges elige su contraseña del panel y la guarda en el **Secure Vault**
  (nunca por chat).
- El hash bcrypt se genera así (en local, una sola vez):

  ```bash
  node -e "console.log(require('bcryptjs').hashSync('SU_CONTRASEÑA', 10))"
  ```

  Ese hash es el valor de `ADMIN_PASSWORD_HASH` en Render.
- Si en algún momento se pierde, se genera un hash nuevo y se actualiza
  la variable en Render (el servidor la lee al arrancar).

### Clave de publicación de Muse

- El valor de `PUBLISH_KEY` ya existe: está solo en
  `~/workspace/el-juego-del-dinero-blog/PUBLISH_KEY.txt` (chmod 600).
- Copiarlo a la variable `PUBLISH_KEY` de Render. **No** escribirlo en
  chat, correo ni ningún otro archivo.
- Si se filtra o se pierde, generar una nueva con
  `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`,
  actualizar Render y el archivo local.

## 4. Dominio — apuntar 18puro.com a Render

El dominio vive en IONOS, cuenta `joshuageorges16@gmail.com`
(el DNS se gestiona ahí; la tienda Shopify congelada ya no se usa).

1. En el servicio de Render: **Settings → Custom Domain → Add**,
   agregar `18puro.com` y `www.18puro.com`. Render mostrará los registros
   DNS necesarios (los valores exactos que dé Render mandan).
2. En IONOS (cuenta del dominio), en la zona DNS de `18puro.com`:
   - Eliminar los registros de Shopify: `A @ → 23.227.38.65`,
     `AAAA @ → 2620:127:f00f:5::`, `CNAME www → shops.myshopify.com`
     y el CNAME de verificación `f4c120b4-... → dns-verification.shopify.com`.
   - Agregar `A @ → <IP que indique Render>` (mismo patrón que
     reavivaapp.com: `A @ → 216.24.57.1`).
   - Agregar `CNAME www → <servicio>.onrender.com`.
   - **No tocar** los registros de correo: `MX @ → mx00/mx01.ionos.com`,
     `TXT @ (SPF)`, `CNAME _dmarc`, `s1/s2-ionos._domainkey`, `autodiscover`.
3. Esperar propagación DNS (minutos a pocas horas) y verificar:
   `https://18puro.com/api/health` → `{"ok":true,...}`.
   Render emite el certificado SSL automáticamente.

## 5. Verificación final

- [ ] `https://18puro.com/` muestra "Próximamente" (blog vacío).
- [ ] `https://18puro.com/admin` → login; entrar con la contraseña de
      Georges; crear un artículo de prueba, publicarlo y verlo en la portada.
- [ ] `https://18puro.com/sitemap.xml` y `/rss.xml` devuelven XML válido.
- [ ] Publicar un artículo por API con la `PUBLISH_KEY` (ver README.md).
- [ ] Eliminar el artículo de prueba (el blog debe quedar vacío hasta
      que Georges levante el bloqueo y apruebe el primer contenido real).

## Notas

- El plan gratuito de Render se duerme tras ~15 min sin tráfico: la
  primera visita tarda ~30–60 s. Si el blog crece, valorar el plan
  Starter (7 USD/mes) para que no se duerma.
- El nombre "18puro" puede leerse como contenido para adultos y
  complicar la aprobación de AdSense. Si Google lo rechaza, el blog se
  puede mover a otro dominio sin perder el contenido (exportar la tabla
  `articles` de Turso e importarla en la nueva base).
- AdSense: cuando el blog tenga contenido, el script de verificación se
  agrega en `server.js` (función `pageShell`, sección `<head>`), igual
  que se hizo en reavivatufe.com con WPCode.
