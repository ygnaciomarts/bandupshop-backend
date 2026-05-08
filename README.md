# BandUp Shop Backend - Guía de Setup

## Requisitos
- Node.js 16+
- MySQL 5.7+

## Instalación

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar base de datos

#### Opción A: Usar el script SQL
```bash
mysql -u root < setup.sql
```

#### Opción B: Manual
Abre MySQL y ejecuta:
```sql
CREATE DATABASE IF NOT EXISTS bandup_shop;
USE bandup_shop;
-- Luego ejecuta el contenido de setup.sql
```

### 3. Configurar variables de entorno
Crear archivo `.env` con:
```
PORT=3001
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=bandup_shop
JWT_SECRET=bUp$2026!xK9mZqR7wPjL4nVcYs3hDfA
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3001
```

### 4. Iniciar el servidor
```bash
npm start
# o en desarrollo:
npm run dev
```

El servidor estará disponible en `http://localhost:3001`

## Usuarios de prueba
- **Admin**: usuario `admin` / contraseña `demo123`
- **Demo**: usuario `demo` / contraseña `demo123`

## API Endpoints

### Autenticación
- `POST /api/auth/login` - Iniciar sesión
- `POST /api/auth/register` - Registrar nuevo usuario
- `GET /api/auth/me` - Obtener usuario actual

### Productos
- `GET /api/products` - Listar productos
- `GET /api/products/:id` - Obtener producto
- `POST /api/products` - Crear producto (admin)
- `PUT /api/products/:id` - Actualizar producto (admin)
- `DELETE /api/products/:id` - Eliminar producto (admin)

### Órdenes
- `POST /api/orders` - Crear orden
- `GET /api/orders` - Listar órdenes del usuario
- `GET /api/orders/:id` - Obtener detalle de orden

## Solución de problemas

### Error: "Las contraseñas no coinciden"
- Asegúrate de que ambas contraseñas sean idénticas
- El campo `confirm_password` es obligatorio

### Error: "Error al registrar el usuario"
- Verifica que la base de datos `bandup_shop` existe
- Verifica que la tabla `usuarios` fue creada correctamente
- Verifica que MySQL está corriendo
- Revisa los logs en la consola del servidor

### Error: "Access denied" en MySQL
- Verifica que el usuario y contraseña en `.env` son correctos
- La contraseña puede estar vacía si no la configuraste

