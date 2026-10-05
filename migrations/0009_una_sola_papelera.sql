-- Una sola papelera: lo archivado se muda a ella.
--
-- «Archivo» y «papelera» eran dos cajones para lo mismo, y para elegir entre
-- ellos habia que saber de antemano si la historia de eso iba a importar, que
-- es justo lo que uno no sabe en el momento de sacarlo de en medio.
--
-- Nada se pierde: lo archivado pasa a estar en la papelera, visible y
-- restaurable de un toque. Y lo que tenga movimientos no se borra nunca, ni a
-- los 30 dias ni a mano, asi que lo que hacia el archivo lo sigue haciendo la
-- papelera, sin pedirle a nadie que lo decida antes.
--
-- trashed_by queda en NULL a proposito: nadie lo tiro, lo movio la migracion,
-- y poner a una de las dos personas ahi seria inventar un dato.

UPDATE category SET trashed_at = unixepoch() * 1000, archived = 0
  WHERE archived = 1 AND trashed_at IS NULL;

UPDATE account SET trashed_at = unixepoch() * 1000, archived = 0
  WHERE archived = 1 AND trashed_at IS NULL;

UPDATE entity SET trashed_at = unixepoch() * 1000, archived = 0
  WHERE archived = 1 AND trashed_at IS NULL;
