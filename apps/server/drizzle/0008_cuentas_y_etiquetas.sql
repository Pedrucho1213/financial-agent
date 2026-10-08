CREATE TABLE `etiquetas` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`nombre` text NOT NULL,
	`nombre_normalizado` text NOT NULL,
	`activa_desde` text,
	`activa_hasta` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`eliminado_en` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `etiquetas_usuario_nombre` ON `etiquetas` (`usuario_id`,`nombre_normalizado`);--> statement-breakpoint
ALTER TABLE `cuentas` ADD `limite_centavos` integer;--> statement-breakpoint
ALTER TABLE `cuentas` ADD `saldo_centavos` integer;--> statement-breakpoint
ALTER TABLE `cuentas` ADD `saldo_tipo` text;--> statement-breakpoint
ALTER TABLE `cuentas` ADD `saldo_en` text;--> statement-breakpoint
ALTER TABLE `movimientos` ADD `etiquetas` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Bancos que solo dan tarjeta de crédito (o solo débito): las cuentas que ya existen con ese nombre toman su tipo.
UPDATE `cuentas` SET `tipo` = 'credito' WHERE `tipo` = 'otra' AND lower(trim(`nombre`)) IN ('invex', 'stori', 'amex', 'american express', 'rappicard', 'rappi card', 'didi card', 'liverpool', 'palacio de hierro', 'costco', 'sears');--> statement-breakpoint
-- lower() de SQLite solo cambia ASCII: 'UALÁ' queda 'ualÁ'.
UPDATE `cuentas` SET `tipo` = 'debito' WHERE `tipo` = 'otra' AND lower(trim(`nombre`)) IN ('revolut', 'hey banco', 'albo', 'fondeadora', 'spin', 'spin by oxxo', 'uala', 'ualá', 'ualÁ', 'openbank');--> statement-breakpoint
-- Un pago de tarjeta guardaba la tarjeta en `cuenta_id`; ahora es el destino del dinero y `cuenta_id` es de dónde salió.
UPDATE `movimientos` SET `cuenta_destino_id` = `cuenta_id`, `cuenta_id` = NULL WHERE `tipo` = 'pago_tarjeta' AND `cuenta_destino_id` IS NULL AND `cuenta_id` IN (SELECT `id` FROM `cuentas` WHERE `tipo` = 'credito');
