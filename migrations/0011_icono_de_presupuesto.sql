-- Un ícono para cada presupuesto.
--
-- Todo lo demás que se lista en esta app lo tiene —las jarras, las categorías,
-- las cuentas, las economías— y son justamente las listas que se leen de un
-- vistazo. Los presupuestos eran la única lista de puro texto.
--
-- NULL = sin elegir; la pantalla pone uno genérico.
ALTER TABLE budget ADD COLUMN icon TEXT;
