'use strict';

exports = module.exports = async function (options) {
	const db = options.db;

	let sql = '';

	sql += 'CREATE TABLE IF NOT EXISTS `images_images` (\n';
	sql += ' `uuid` binary(16) NOT NULL,\n';
	sql += ' `slug` varchar(255) CHARACTER SET ascii NOT NULL,\n';
	sql += ' `type` varchar(255) CHARACTER SET ascii NOT NULL,\n';
	sql += ' PRIMARY KEY (`uuid`), UNIQUE KEY `slug` (`slug`)\n';
	sql += ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';

	await db.query(sql);

	sql = 'CREATE TABLE IF NOT EXISTS `images_images_metadata` (\n';
	sql += ' `imageUuid` binary(16) NOT NULL,\n';
	sql += ' `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,\n';
	sql += ' `data` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,\n';
	sql += ' KEY `imageUuid` (`imageUuid`),\n';
	sql += ' CONSTRAINT `images_images_metadata_ibfk_1`\n';
	sql += ' FOREIGN KEY (`imageUuid`) REFERENCES `images_images` (`uuid`) ON DELETE NO ACTION\n';
	sql += ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';

	await db.query(sql);
};
