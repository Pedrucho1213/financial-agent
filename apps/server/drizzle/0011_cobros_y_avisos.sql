CREATE TABLE `cobros` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`recurrente_id` text NOT NULL,
	`fecha` text NOT NULL,
	`monto_esperado_centavos` integer NOT NULL,
	`moneda` text DEFAULT 'MXN' NOT NULL,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`movimiento_id` text,
	`movimiento_creado` integer DEFAULT false NOT NULL,
	`monto_real_centavos` integer,
	`confirmado_por` text,
	`confirmado_en` text,
	`precio_anterior_centavos` integer,
	`posponer_hasta` text,
	`notificaciones` integer DEFAULT 0 NOT NULL,
	`notificado_en` text,
	`pregunta` text,
	`preguntado_en` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cobros_recurrente_fecha` ON `cobros` (`recurrente_id`,`fecha`);--> statement-breakpoint
CREATE INDEX `cobros_usuario_estado` ON `cobros` (`usuario_id`,`estado`);--> statement-breakpoint
ALTER TABLE `recurrentes` ADD `confirmar_solo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `recurrentes` ADD `comercio_id` text;--> statement-breakpoint
ALTER TABLE `usuarios` ADD `preferencias_avisos` text;