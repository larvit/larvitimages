ALTER TABLE `images_images_metadata` ADD FULLTEXT INDEX IF NOT EXISTS `ft_data` (`data`);
