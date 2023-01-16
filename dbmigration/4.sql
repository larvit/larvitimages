ALTER TABLE `images_images` ADD IF NOT EXISTS `identifier` binary(16) NULL AFTER `type`;
ALTER TABLE `images_images` ADD INDEX IF NOT EXISTS `identifier` (`identifier`);
