CREATE TABLE `descargas_atajo` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`archivo` blob NOT NULL,
	`expira_en` text NOT NULL,
	`descargas` integer DEFAULT 0 NOT NULL,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
