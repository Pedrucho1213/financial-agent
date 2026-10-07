CREATE TABLE `avisos` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`tipo` text NOT NULL,
	`clave` text NOT NULL,
	`titulo` text NOT NULL,
	`texto` text NOT NULL,
	`fecha` text NOT NULL,
	`vence` text,
	`prioridad` integer DEFAULT 2 NOT NULL,
	`enlace` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`enviado_en` text,
	`dicho_en` text,
	`leido_en` text,
	`descartado_en` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `avisos_usuario_clave` ON `avisos` (`usuario_id`,`clave`);--> statement-breakpoint
CREATE INDEX `avisos_usuario_fecha` ON `avisos` (`usuario_id`,`fecha`);--> statement-breakpoint
ALTER TABLE `metas` ADD `eliminado_en` text;--> statement-breakpoint
ALTER TABLE `prestamos_personales` ADD `pagado_centavos` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `prestamos_personales` ADD `eliminado_en` text;--> statement-breakpoint
ALTER TABLE `presupuestos` ADD `eliminado_en` text;--> statement-breakpoint
ALTER TABLE `usuarios` ADD `revisado_para` text;