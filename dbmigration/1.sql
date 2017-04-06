CREATE TABLE IF NOT EXISTS `images_images` (
	`uuid` binary(16) NOT NULL,
	`slug` varchar(255) CHARACTER SET ascii NOT NULL,
	`type` varchar(255) CHARACTER SET ascii NOT NULL,
	PRIMARY KEY (`uuid`), UNIQUE KEY `slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `images_images_metadata` (
	`imageUuid` binary(16) NOT NULL,
	`name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
	`data` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
	KEY `imageUuid` (`imageUuid`),
	CONSTRAINT `images_images_metadata_ibfk_1`
	FOREIGN KEY (`imageUuid`) REFERENCES `images_images` (`uuid`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
