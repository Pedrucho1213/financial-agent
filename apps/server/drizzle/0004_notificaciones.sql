CREATE TABLE `avisos` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`fecha` text NOT NULL,
	`tipo` text NOT NULL,
	`titulo` text NOT NULL,
	`texto` text NOT NULL,
	`url` text,
	`prioridad` integer DEFAULT 0 NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`dicho_en` text,
	`notificado_en` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `avisos_unico` ON `avisos` (`usuario_id`,`fecha`,`tipo`,`titulo`);--> statement-breakpoint
CREATE TABLE `configuracion` (
	`clave` text PRIMARY KEY NOT NULL,
	`valor` text NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suscripciones_push` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`dispositivo_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`contacto` text NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`ultimo_envio` text,
	`ultimo_error` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dispositivo_id`) REFERENCES `dispositivos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suscripciones_push_endpoint` ON `suscripciones_push` (`endpoint`);--> statement-breakpoint
CREATE INDEX `suscripciones_push_usuario` ON `suscripciones_push` (`usuario_id`);--> statement-breakpoint
ALTER TABLE `entradas` ADD `origen` text DEFAULT 'voz' NOT NULL;