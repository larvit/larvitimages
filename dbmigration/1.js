'use strict';

const	logPrefix	= 'larvitimages: ./dbmigration/1.js: ',
	uuidLib	= require('uuid'),
	ImgLib	= require(__dirname + '/../index.js'),
	LUtils	= require('larvitutils'),
	lUtils	= new LUtils(),
	async	= require('async'),
	fs	= require('fs');

exports = module.exports = function (cb) {
	const	tasks	= [],
		that	= this,
		img	= new ImgLib({'db': that.options.dbDriver, 'log': that.log}),
		db	= that.options.dbDriver;

	function createTables(cb) {
		const	tasks	= [];

		tasks.push(function (cb) {
			let	sql	= '';

			sql += 'CREATE TABLE IF NOT EXISTS `images_images` (\n';
			sql += '	`uuid` binary(16) NOT NULL,\n';
			sql += '	`slug` varchar(255) CHARACTER SET ascii NOT NULL,\n';
			sql += '	`type` varchar(255) CHARACTER SET ascii NOT NULL,\n';
			sql += '	PRIMARY KEY (`uuid`), UNIQUE KEY `slug` (`slug`)\n';
			sql += ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';

			db.query(sql, cb);
		});

		tasks.push(function (cb) {
			let	sql	= '';

			sql += 'CREATE TABLE IF NOT EXISTS `images_images_metadata` (\n';
			sql += '	`imageUuid` binary(16) NOT NULL,\n';
			sql += '	`name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,\n';
			sql += '	`data` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,\n';
			sql += '	KEY `imageUuid` (`imageUuid`),\n';
			sql += '	CONSTRAINT `images_images_metadata_ibfk_1`\n';
			sql += '	FOREIGN KEY (`imageUuid`) REFERENCES `images_images` (`uuid`) ON DELETE NO ACTION\n';
			sql += ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';

			db.query(sql, cb);
		});

		async.series(tasks, cb);
	}

	// Fetch Image data from old table
	tasks.push(function (cb) {
		db.query('SHOW TABLES', function (err, rows) {
			const	uuidsToIds	= {},
				tasks	= [];

			let	found	= false;

			if (err) return cb(err);

			for (let i = 0; rows[i] !== undefined; i ++) {
				for (const colName of Object.keys(rows[i])) {
					if (rows[i][colName] === 'images_images') {
						found	= true;
					}
				}
			}

			if (found === false) {
				that.log.info(logPrefix + 'No previous table to handle migrations from');
				return createTables(cb);
			}

			// Rename old table
			tasks.push(function (cb) {
				db.query('RENAME TABLE images_images TO images_images_old;', cb);
			});

			// Create new tables
			tasks.push(function (cb) {
				createTables(cb);
			});

			// Insert basic data
			tasks.push(function (cb) {
				db.query('SELECT id, slug FROM images_images_old', function (err, rows) {
					const	tasks	= [];

					if (err) return cb(err);

					for (let i = 0; rows[i] !== undefined; i ++) {
						const	uuid	= uuidLib.v4(),
							row	= rows[i];

						let	type;

						uuidsToIds[uuid]	= row.id;

						if (row.slug.substring(row.slug.length - 3).toLowerCase() === 'jpg') {
							type	= 'jpg';
						} else if (row.slug.substring(row.slug.length - 3).toLowerCase() === 'png') {
							type	= 'png';
						} else if (row.slug.substring(row.slug.length - 3).toLowerCase() === 'gif') {
							type	= 'gif';
						} else {
							const	err	= new Error('No valid type found for slug: "' + row.slug + '" with id: "' + row.id + '"');
							that.log.error(logPrefix + err.message);
							return cb(err);
						}

						tasks.push(function (cb) {
							db.query('INSERT INTO images_images (uuid, slug, type) VALUES(?,?,?);', [lUtils.uuidToBuffer(uuid), row.slug, type], cb);
						});
					}

					async.parallelLimit(tasks, 20, cb);
				});
			});

			// Insert metadata about old Ids
			tasks.push(function (cb) {
				const	tasks	= [];

				for (const imageUuid of Object.keys(uuidsToIds)) {
					tasks.push(function (cb) {
						const	sql	= 'INSERT INTO images_images_metadata (imageUuid, name, data) VALUES(?,?,?);';

						db.query(sql, [lUtils.uuidToBuffer(imageUuid), 'oldImageId', uuidsToIds[imageUuid]], cb);
					});
				}

				async.parallelLimit(tasks, 20, cb);
			});

			// Write files to disk
			tasks.push(function (cb) {
				const	tasks	= [];

				for (const uuid of Object.keys(uuidsToIds)) {
					tasks.push(function (cb) {
						db.query('SELECT image FROM images_images_old WHERE id = ?', [uuidsToIds[uuid]], function (err, rows) {
							const	imgBin	= rows[0].image;

							if (err) return cb(err);

							if (rows.length === 0) {
								throw new Error('Can not find image for uuid: "' + uuid + '", id: "' + uuidsToIds[uuid] + '"');
							}

							db.query('SELECT type FROM images_images WHERE uuid = ?', [lUtils.uuidToBuffer(uuid)], function (err, rows) {
								if (err) return cb(err);

								if (rows.length === 0) {
									throw new Error('Can not find type for uuid: "' + uuid + '"');
								}

								img.createImageDirectory(uuid, function (err, path) {
									if (err) return cb(err);

									fs.writeFile(path + uuid + '.' + rows[0].type, imgBin, cb);
								});
							});
						});
					});
				}

				async.parallelLimit(tasks, 20, cb);
			});

			// Drop old table
			tasks.push(function (cb) {
				db.query('DROP TABLE images_images_old', cb);
			});

			async.series(tasks, cb);
		});
	});

	async.series(tasks, cb);
};
