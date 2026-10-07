ALTER TABLE `usuarios` ADD `usuario` text;--> statement-breakpoint
ALTER TABLE `usuarios` ADD `codigo_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `usuarios_usuario` ON `usuarios` (`usuario`);