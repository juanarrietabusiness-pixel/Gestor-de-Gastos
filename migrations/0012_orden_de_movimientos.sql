-- El orden de la pantalla de movimientos, como el del inicio.
--
-- Mismo mecanismo: una lista JSON en una columna de texto, por persona. Vacío
-- significa «el de fábrica», así que nadie tiene que estrenarlo.
ALTER TABLE member ADD COLUMN moves_layout TEXT NOT NULL DEFAULT '';
