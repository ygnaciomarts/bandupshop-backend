-- Crear base de datos bandup_shop
CREATE DATABASE IF NOT EXISTS bandup_shop;
USE bandup_shop;

-- Crear tabla usuarios
CREATE TABLE IF NOT EXISTS usuarios (
  id INT PRIMARY KEY AUTO_INCREMENT,
  usuario VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  apellido VARCHAR(255),
  su TINYINT DEFAULT 0,
  img LONGBLOB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CHARSET utf8mb4,
  COLLATE utf8mb4_unicode_ci
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Crear tabla productos
CREATE TABLE IF NOT EXISTS productos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(255) NOT NULL,
  artista VARCHAR(255) NOT NULL,
  tipo VARCHAR(50) NOT NULL,
  precio INT NOT NULL,
  precio_original INT,
  precio_descuento INT,
  existencias INT DEFAULT 0,
  genero VARCHAR(255),
  descripcion TEXT,
  cover LONGBLOB,
  cover_url VARCHAR(500),
  rating DECIMAL(3,2),
  featured BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CHARSET utf8mb4,
  COLLATE utf8mb4_unicode_ci
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Crear tabla órdenes
CREATE TABLE IF NOT EXISTS ordenes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  usuario_id INT NOT NULL,
  total INT NOT NULL,
  estado VARCHAR(50) DEFAULT 'pendiente',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CHARSET utf8mb4,
  COLLATE utf8mb4_unicode_ci
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Crear tabla items de órdenes
CREATE TABLE IF NOT EXISTS orden_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  orden_id INT NOT NULL,
  producto_id INT NOT NULL,
  cantidad INT NOT NULL,
  precio INT NOT NULL,
  FOREIGN KEY (orden_id) REFERENCES ordenes(id) ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL,
  CHARSET utf8mb4,
  COLLATE utf8mb4_unicode_ci
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Crear tabla reseñas
CREATE TABLE IF NOT EXISTS resenas (
  id INT PRIMARY KEY AUTO_INCREMENT,
  producto_id INT NOT NULL,
  usuario_id INT NOT NULL,
  rating INT NOT NULL,
  comentario TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CHARSET utf8mb4,
  COLLATE utf8mb4_unicode_ci
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insertar datos de prueba
INSERT INTO usuarios (usuario, email, password, nombre, apellido, su) VALUES 
('admin', 'admin@bandup.com', '$2b$10$ILvagwCE9I7MNdI2qH3KHeZDAWQmF3Mzwc8VsAiBQrEU3H8WiMW9m', 'Admin', 'User', 1),
('demo', 'demo@bandup.com', '$2b$10$ILvagwCE9I7MNdI2qH3KHeZDAWQmF3Mzwc8VsAiBQrEU3H8WiMW9m', 'Demo', 'User', 0);

INSERT INTO productos (nombre, artista, tipo, precio, existencias, genero, descripcion) VALUES 
('Perfect Day', 'Velvet Underground', 'LP', 699, 5, 'Rock Clásico', 'Un clásico del rock'),
('Midnight Run', 'Neon Echoes', 'CD', 299, 10, 'Rock Alternativo', 'Electrizante colección de tracks'),
('Heaven', 'Echo Dreams', 'Cassette', 199, 3, 'Indie Pop', 'Edición limitada en cassette');

COMMIT;
