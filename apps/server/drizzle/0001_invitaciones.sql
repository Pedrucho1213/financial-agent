CREATE TABLE `invitaciones` (
	`id` text PRIMARY KEY NOT NULL,
	`codigo` text NOT NULL,
	`usuario_id` text,
	`creada_por` text,
	`expira_en` text NOT NULL,
	`usada_en` text,
	`dispositivo_id` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creada_por`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitaciones_codigo` ON `invitaciones` (`codigo`);