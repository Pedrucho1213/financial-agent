ALTER TABLE `entradas` ADD `entregada_en` text;--> statement-breakpoint
-- Lo de antes ya se dio por entregado: no se repite ninguna pregunta vieja al desplegar.
UPDATE `entradas` SET `entregada_en` = `creado_en`;
