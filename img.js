'use strict';

const	uuidValidate	= require('uuid-validate'),
	imageType	= require('image-type'),
	uuidLib	= require('node-uuid'),
	slugify	= require('larvitslugify'),
	events	= require('events'),
	mkdirp	= require('mkdirp'),
	async	= require('async'),
	lUtils	= require('larvitutils'),
	path	= require('path'),
	lwip	= require('lwip'),
	log	= require('winston'),
	os	= require('os'),
	fs	= require('fs-extra'),
	db	= require('larvitdb'),
	_	= require('lodash');

let	eventEmitter	= new events.EventEmitter(),
	dbChecked	= false,
	config	= require(__dirname + '/config/images.json');

if (config.cachePath !== undefined) {
	exports.cacheDir = config.cachePath;
} else {
	exports.cacheDir = os.tmpdir() + '/larvitimages_cache';
}

/**
 * Get path to image
 *
 * @param str	- 'd893b68d-bb64-40ac-bec7-14e640a235a6'
 *
 */
function getPathToImage(uuid, cache) {
	if (cache) {
		return exports.cacheDir + uuid.substr(0, 4).split('').join('/') + '/';
	} else {
		return	config.storagePath + uuid.substr(0, 4).split('').join('/') + '/';
	}
}

/**
 * Get path to image
 *
 * @param str uuid 	- 'd893b68d-bb64-40ac-bec7-14e640a235a6'
 * @param bool cache	- true/false // optional
 * @param func cb	- callback(err, path)
 *
 */
function createImageDirectory(uuid, cache, cb) {
	let path = '';

	if (typeof cache === 'function') {
		cb	= cache;
		cache	= false;
	}

	// Check if storage path is defined and set it.
	if (config.storagePath === undefined) {
		cb(new Error('No defined path for storing images.'));
		return;
	}

	if (cache) {
		path = exports.cacheDir + uuid.substr(0, 4).split('').join('/') + '/';
	} else {
		path	= config.storagePath + uuid.substr(0, 4).split('').join('/') + '/';
	}

	if ( ! uuidValidate(uuid, 4)) { cb(new Error('Invalid uuid')); return; }
	if ( ! fs.existsSync(path)) {
		mkdirp(path, function(err) {
			if (err) {
				log.error('larvitimages: createImageDirectory() - Could not create folder: "' + pathr + '" err: ' + err.message);
			} else {
				log.verbose('larvitimages: createImageDirectory() - Folder "' + path + '" created');
			}

			cb(err, path);
		});
	}
}


/**
 * Clear Cache
 *
 * @param obj options -	{ // All options are optional!
 *		'slug':	'slug'	// As strin
 *		'uuid':	'd893b68d-bb64-40ac-bec7-14e640a235a6'	// As string
 *		'clearAll':	boolean	// If true it clears all cache. Options object empty = true
 *	}
 * @param func cb - callback(err)
 */
function clearCache(options, cb) {
	const	tasks	= [];
	let	exists;

	if (typeof options === 'function') {
		cb	= options;
		options	= {};
	}

	if (Object.keys(options).length === 0) {
		options.clearAll = true;
	}

	if (typeof cb !== 'function') {
		cb	= function(){};
	}

	if (options.clearAll) {
		tasks.push(function(cb) {
			fs.stat(exports.cacheDir, function(err, stats) {
				if (err && err.code === 'ENOENT') {
					exists = false;
					cb();
					return;
				} else if (err) {
					log.error('larvitimages: clearCache() - Unknown error when fs.stat(' + exports.cacheDir + '): ' + err.message);
					cb(err);
					return;
				}

				exists	= stats.isDirectory();
				cb();
			});
		});

		// Delete
		tasks.push(function(cb) {
			fs.remove(exports.cacheDir, cb);
		});
	} else {

		// if no uuid is given get image data by slug.
		if (options.uuid === undefined) {
			tasks.push(function(cb) {
				getImages({'slugs': [options.slug]}, function(err, image) {
					if (err) throw err;
					if (Object.keys(image).length === 0) {
						log.warn('larvitimages: clearCache() - No image found in database with slug: ' +  options.slug);
						exists = false;
					} else {
						options.uuid = lUtils.formatUuid(image[Object.keys(image)[0]].uuid);
					}
					cb();
				});
			});
		}


		// Check if the folder exists at all
		tasks.push(function(cb) {
			if (exists === false) {
				cb();
				return;
			}

			fs.stat(getPathToImage(options.uuid, true), function(err, stats) {
				if (err && err.code === 'ENOENT') {
					exists = false;
					cb();
					return;
				} else if (err) {
					log.error('larvitimages: clearCache() - Unknown error when fs.stat(' + exports.cacheDir + '): ' + err.message);
					cb(err);
					return;
				}

				exists	= stats.isDirectory();
				cb();
			});
		});


		// Remove files
		tasks.push(function(cb) {
			const	tasks	= [];

			if (exists === false) {
				cb();
				return;
			}

			fs.readdir(getPathToImage(options.uuid, true), function(err, files) {
				if (err) { cb(err); return; }

				for (let i = 0; files[i] !== undefined; i ++) {
					const	fileName	= files[i];

					if (fileName.substring(0, options.uuid.length) === options.uuid) {
						tasks.push(function(cb) {
							fs.unlink(getPathToImage(options.uuid, true) + fileName, function(err) {
								if (err) {
									log.warn('larvitimages: clearCache() - Could not remove file: "' + fileName + '", err: ' + err.message);
								}
								cb(err);
							});
						});
					}
				}

				async.parallel(tasks, cb);
			});
		});
	}



	async.series(tasks, cb);
}

// Create database tables if they are missing
function createTablesIfNotExists(cb) {
	const tasks = [];

	// Create Image table
	tasks.push(function(cb) {
		const	sql	= 'CREATE TABLE IF NOT EXISTS `images_images` (`uuid` binary(16) NOT NULL, `slug` varchar(255) CHARACTER SET ascii NOT NULL, `type` varchar(255) CHARACTER SET ascii NOT NULL, PRIMARY KEY (`uuid`), UNIQUE KEY `slug` (`slug`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';
		db.query(sql, cb);
	});

	// Create metadata table
	tasks.push(function(cb) {
		const	sql	= 'CREATE TABLE `images_images_metadata` (`imageUuid` binary(16) NOT NULL,`name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,`data` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL, KEY `imageUuid` (`imageUuid`), CONSTRAINT `images_images_metadata_ibfk_1` FOREIGN KEY (`imageUuid`) REFERENCES `images_images` (`uuid`) ON DELETE NO ACTION) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';
		db.query(sql, cb);
	});

	async.parallel(tasks, function(err) {
		if (err) { cb(err); return; }
		dbChecked = true;
		eventEmitter.emit('checked');
	});

}
createTablesIfNotExists(function(err) {
	log.error('larvitimages: createTablesIfNotExists() - Database error: ' + err.message);
});

function getImageBin(options, cb) {

	let	existingFile,
		cachedFile,
		fileToLoad,
		imgType,
		uuid;

	getImages({'slugs': options.slug}, function(err, images) {
		if (err) { cb(err); return; }

		if (images.length === 0) {
			cb(new Error('File not found'));
			return;
		}

		uuid	= uuidLib.unparse(images[0].uuid);
		imgType	=	images[0].type;
		existingFile	= getPathToImage(uuid, false) + uuid + '.' + imgType;
		cachedFile	= getPathToImage(uuid, true) + uuid;
		fileToLoad	= existingFile;

		if (options.width || options.height) {
			if (options.width)	cachedFile += '_w' + options.width;
			if (options.height)	cachedFile += '_h' + options.height;
			cachedFile += '.' + imgType;
			fileToLoad = cachedFile;
		}

		// Check if cached file exists, and if so, return it
		function returnFile(cb) {
			fs.readFile(fileToLoad, function(err, fileBuf) {
				if (err || ! fileBuf) {
					createFile(function(err) {
						if (err) { cb(err); return; }
						returnFile(cb);
					});
					return;
				}
				cb(null, fileBuf);
			});
		}

		function createFile(cb) {
			fs.readFile(existingFile, function(err, image) {
				let	imgRatio;

				if (err) { cb(err); return; }

				if (options.width || options.height) {
					lwip.open(image, imgType, function(err, lwipImage) {
						let	imgWidth,
							imgHeight;

						if (err) { cb(err); return; }

						imgWidth	= lwipImage.width();
						imgHeight	= lwipImage.height();
						imgRatio	= imgWidth / imgHeight;

						// Set the missing height or width if only one is given
						if (options.width && ! options.height) {
							options.height = Math.round(options.width / imgRatio);
						}

						if (options.height && ! options.width) {
							options.width = Math.round(options.height * imgRatio);
						}

						if ( ! lUtils.isInt(options.height) || ! lUtils.isInt(options.width)) {
							const err = new Error('Options.height or options.width is not an integer. Options: ' + JSON.stringify(options));
							log.warn('larvitimages: getImageBin() - createFile() - ' + err.message);
							cb(err);
							return;
						}

						lwipImage.batch()
							.resize(parseInt(options.width), parseInt(options.height))
							.toBuffer(imgType, {}, function(err, imgBuf) {
								if (err) {
									log.warn('larvitimages: getImageBin() - createFile() - Error from lwip: ' + err.message);
									cb(err);
									return;
								}

								mkdirp(path.dirname(cachedFile), function(err) {
									if (err && err.message.substring(0, 6) !== 'EEXIST') {
										log.warn('larvitimages: getImageBin() - createFile() - Error from lwip: ' + err.message);
										cb(err);
										return;
									}

									fs.writeFile(cachedFile, imgBuf, cb);
								});
							});
					});
				} else {
					mkdirp(path.dirname(cachedFile), function(err) {
						if (err && err.message.substring(0, 6) !== 'EEXIST') {
							log.warn('larvitimages: getImageBin() - createFile() - Could not create folder: ' + err.message);
							cb(err);
							return;
						}

						fs.writeFile(cachedFile, images[0].image, cb);
					});
				}
			});
		}

		returnFile(cb);
	});
}

/**
 * Get images
 *
 * @param obj options -	{ // All options are optional!
 *		'slugs':	['blu', 'bla'],	// With or without file ending
 *		'uuids':	[d893b68d-bb64-40ac-bec7-14e640a235a6,d893b68d-bb64-40ac-bec7-14e640a235a6],	//
 *		'limit':	10,	// Defaults to 10, explicitly give false for no limit
 *		'offset':	20,	//
 *		'includeBinaryData':	true	// Defaults to false
 *	}
 * @param func cb - callback(err, images)
 */
function getImages(options, cb) {
	const	dbFields	= [],
		metadata	= [],
		images	= {},
		tasks	= [];

	if (typeof options === 'function') {
		cb	= options;
		options	= {};
	}

	// Make sure options that should be arrays actually are arrays
	// This will simplify our lives in the SQL builder below
	if (options.uuids !== undefined && ! (options.uuids instanceof Array)) {
		options.uuids = [options.uuids];
	}

	if (options.slugs !== undefined && ! (options.slugs instanceof Array)) {
		options.slugs = [options.slugs];
	}

	// Trim slugs from slashes
	if (options.slugs) {
		_.each(options.slugs, function(slug, idx) {
			options.slugs[idx] = _.trim(slug, '/');
		});
	}

	// Make sure there is an invalid ID in the id list if it is empty
	// Since the most logical thing to do is replying with an empty set
	if (options.uuids instanceof Array && options.uuids.length === 0) {
		options.uuids.push(- 1);
	}

	if (options.limit === undefined) {
		options.limit = 10;
	}

	// Convert uuids to buffers
	if (options.uuids !== undefined) {
		for (let i = 0; options.uuids[i] !== undefined; i ++) {
			if ( ! (options.uuids[i] instanceof Buffer))  {
				options.uuids[i] = new Buffer(uuidLib.parse(options.uuids[i]));
			}
		}
	}

	// Make sure the database tables exists before going further!
	if ( ! dbChecked) {
		log.debug('larvitimages: getImages() - Database not checked, rerunning this method when event have been emitted.');
		eventEmitter.on('checked', function() {
			log.debug('larvitimages: getImages() - Database check event received, rerunning getImages().');
			getImages(options, cb);
		});

		return;
	}

	log.debug('larvitimages: getImages() - Called with options: "' + JSON.stringify(options) + '"');


	function generateWhere() {
		let sql = '';

		sql +=	'WHERE 1 + 1\n';

		// Only get posts with the current slugs
		if (options.slugs !== undefined) {
			sql += '	AND (images.slug IN (';

			for (let i = 0; options.slugs[i] !== undefined; i ++) {
				sql += '?,';
				dbFields.push(options.slugs[i]);
			}

			// Select by slug without file ending
			sql = sql.substring(0, sql.length - 1) + ') OR SUBSTRING(images.slug, 1, CHAR_LENGTH(images.slug) - 1 - CHAR_LENGTH(SUBSTRING_INDEX(images.slug, \'.\', -1))) IN (';

			for (let i = 0; options.slugs[i] !== undefined; i ++) {
				sql += '?,';
				dbFields.push(options.slugs[i]);
			}

			sql = sql.substring(0, sql.length - 1) + '))\n';
		}

		// Only get posts with given ids
		if (options.uuids !== undefined) {
			sql += '	AND images.uuid IN (';

			for (let i = 0; options.uuids[i] !== undefined; i ++) {
				sql += '?,';
				dbFields.push(options.uuids[i]);
			}

			sql = sql.substring(0, sql.length - 1) + ')\n';
		}

		return sql;
	}

	// Get images
	tasks.push(function(cb) {
		let	sql =	'SELECT images.uuid, images.slug, images.type\n';
			sql	+=	'FROM images_images as images\n';
			sql	+= generateWhere();
			sql	+= 'ORDER BY images.slug\n';

		if (options.limit) {
			sql += 'LIMIT ' + parseInt(options.limit) + '\n';
		}

		if (options.limit && options.offset !== undefined) {
			sql += ' OFFSET ' + parseInt(options.offset);
		}

		db.query(sql, dbFields, function(err, result) {
			for (let i = 0; result[i] !== undefined; i ++) {
				images[uuidLib.unparse(result[i].uuid)] 	= result[i];
				images[uuidLib.unparse(result[i].uuid)].uuid	= uuidLib.unparse(result[i].uuid);
				images[result[i].uuid].metadata	= [];
			}
			cb(err);
		});
	});

	// Get metadata
	tasks.push(function(cb) {
		let	sql	= '';

		sql	+= 'SELECT * FROM images_images_metadata as metadata\n';
		sql	+= 'WHERE imageUuid IN (SELECT images.uuid FROM images_images as images ' + generateWhere() +  ')';

		db.query(sql, dbFields, function(err, result) {
			for (let i = 0; result[i] !== undefined; i ++) {
				result[i].imageUuid = uuidLib.unparse(result[i].imageUuid);
				metadata.push(result[i]);
			}
			cb(err);
		});
	});

	async.series(tasks, function(err) {
		for (let i = 0; metadata[i] !== undefined; i ++) {
			let imageUuid = metadata[i].imageUuid;
			delete metadata[i].imageUuid;
			images[imageUuid].metadata.push(metadata[i]);
		}


		if (options.includeBinaryData) {
			const	subtasks	= [];
			for (let uuid in images) {
				subtasks.push(function(cb) {
					let	path = getPathToImage(uuid);

						if (err) { cb(err); return; }
						fs.readFile(path + uuid + '.' + images[uuid].type, function(err, image) {
							if (err) { cb(err); return; }
							images[uuid].image = image;
							cb();
						});
				});
			}

			async.parallel(subtasks, function(err) {
				cb(err, images);
			});
		} else {
			cb(err, images);
		}

	});

};

function rmImage(uuid, cb) {
	const	tasks	= [];

	let	slug,
		type;

	// Get slug
	tasks.push(function(cb) {
		db.query('SELECT * FROM images_images WHERE uuid = ?', [new Buffer(uuidLib.parse(uuid))], function(err, rows) {
			if (err) {
				cb(err);
				return;
			}

			if (rows.length > 0) {
				slug	= rows[0].slug;
				type = rows[0].type;
			}

			cb();
		});
	});

	// Delete database entry
	tasks.push(function(cb) {
		db.query('DELETE FROM images_images WHERE uuid = ?', [new Buffer(uuidLib.parse(uuid))], cb);
	});

	// Delete metadata
	tasks.push(function(cb) {
		db.query('DELETE FROM images_images_metadata WHERE imageUuid = ?;', [new Buffer(uuidLib.parse(uuid))], cb);
	});

	// Delete actual file
	tasks.push(function(cb) {
		fs.unlink(getPathToImage(uuid) + uuid + '.' + type, cb);
	});

	tasks.push(function(cb) {
		if ( ! slug) {
			cb();
			return;
		}

		clearCache({'slug': slug}, cb);
	});

	async.series(tasks, cb);
}

/**
 * Save an image
 *
 * @param obj data -	{
 *		'uuid':	d8d2bed2-4da1-4650-968c-7acc81b62c92,
 *		'slug':	'barfoo'
 *		'uploadedFile':	File obj from formidable, see https://github.com/felixge/node-formidable for more info
 *	}
 * @param func cb(err, image) - the image will be a row from getImages()
 */
function saveImage(data, cb) {
	const	tasks	= [];

	log.verbose('larvitimages: saveImage() - Running with data. "' + JSON.stringify(data) + '"');

	// Make sure the database tables exists before going further!
	if ( ! dbChecked) {
		log.debug('larvitimages: saveImage() - Database not checked, rerunning this method when event have been emitted.');
		eventEmitter.on('checked', function() {
			log.debug('larvitimages: saveImage() - Database check event received, rerunning saveImage().');
			exports.saveImage(data, cb);
		});

		return;
	}

	// If id is missing, we MUST have a file
	if (data.uuid === undefined && data.file === undefined) {
		log.info('larvitimages: saveImage() - Upload file is missing, but required since no ID is supplied.');
		cb(new Error('Image file is required'));
		return;
	}


	// If we have an image file, make sure the format is correct
	if (data.file !== undefined) {
		tasks.push(function(cb) {

			// As a first step, check the mime type, since this is already given to us
			if (imageType(data.file.bin).mime !== 'image/png' && imageType(data.file.bin).mime !== 'image/jpeg' && imageType(data.file.bin).mime !== 'image/gif') {
				log.info('larvitimages: saveImage() - Invalid mime type "' + data.uploadedFile.type + '" for uploaded file.');
				cb(new Error('Invalid file format, must be of image type PNG, JPEG or GIF'));
				return;
			}

			// Then actually checks so the file loads in our image lib
			lwip.open(data.file.bin, imageType(data.file.bin).ext, function(err) {
				if (err) {
					log.warn('larvitimages: saveImage() - Unable to open uploaded file: ' + err.message);
					cb(err);
					return;
				}

				cb();
			});
		});
	}

	// Set the slug if needed
	tasks.push(function(cb) {
		const	dbFields	= [];

		let sql;

		// If no slug or uuid was supplied use the filename as base for the slug
		if ( ! data.uuid && ! data.slug) {
			data.slug = data.file.name;
		}

		// If no slug is set by here, it means an id is supplied and the slug
		// should not change in the database, no need to check anything more here
		if ( ! data.slug) {
			cb();
			return;
		} else {
			data.slug	= slugify(data.slug, {'save': ['.', '/']});
			data.slug	= _.trim(data.slug, '/');
		}

		// Make sure it is not occupied by another image
		sql = 'SELECT uuid FROM images_images WHERE slug = ?';
		dbFields.push(data.slug);
		if (data.uuid !== undefined) {
			sql += ' AND uuid != ?';
			dbFields.push(new Buffer(uuidLib.parse(data.uuid)));
		}

		db.query(sql, dbFields, function(err, rows) {
			if (err) { cb(err); return; }

			if (rows.length) {
				cb(new Error('Slug is used by another image entry, try setting another one manually.'));
				return;
			}

			cb();
		});
	});

	// Set image type
	if (data.file !== undefined) {
		tasks.push(function(cb) {
			data.file.type = imageType(data.file.bin).ext;
			cb();
		});
	}

	// Create a new image if id is not set
	if (data.uuid === undefined) {
		tasks.push(function(cb) {
			data.uuid = uuidLib.v4();

			const	sql	= 'INSERT INTO images_images (uuid, slug, type) VALUES(?, ?, ?);',
				dbFields	= [new Buffer(uuidLib.parse(data.uuid)), data.slug, data.file.type];

			db.query(sql, dbFields, function(err) {
				if (err) { cb(err); return; }
				log.debug('larvitimages: saveImage() - New image created with uuid: "' + data.uuid + '"');
				cb();
			});
		});
	}

	// Save file data
	if (data.file) {
		tasks.push(function(cb) {
			createImageDirectory(data.uuid, function(err, path) {
				if (err) { cb(err); return; }
				fs.writeFile(path + data.uuid + '.' + data.file.type, data.file.bin, function(err) {
					if (err) { cb(err); return; }
					cb();
				});
			});
		});
	}

	// Save the slug
	if (data.slug) {
		tasks.push(function(cb) {
			db.query('UPDATE images_images SET slug = ? WHERE uuid = ?', [data.slug, new Buffer(uuidLib.parse(data.uuid))], cb);
		});
	}

	// Save metadata
	// First delete all existing metadata about this image
	tasks.push(function(cb) {
		db.query('DELETE FROM images_images_metadata WHERE imageUuid = ?;', [new Buffer(uuidLib.parse(data.uuid))], cb);
	});

	// Insert new metadata
	if (data.metadata !== undefined) {
		tasks.push(function(cb) {
			const	dbFields	= [];
			let	sql	= 'INSERT INTO images_images_metadata (imageUuid, name, data) VALUES ';

			for (let i = 0; data.metadata[i] !== undefined; i ++) {
				sql += '(?,?,?), ';
				dbFields.push(new Buffer(uuidLib.parse(data.uuid)));
				dbFields.push(data.metadata[i].name);
				dbFields.push(data.metadata[i].data);
			}

			sql = sql.substring(0, sql.length - 2) + ';';
			db.query(sql, dbFields, cb);
		});
	}

	// Clear cache for this slug
	tasks.push(function(cb) {
		db.query('SELECT slug FROM images_images WHERE uuid = ?', [new Buffer(uuidLib.parse(data.uuid))], function(err, rows) {
			if (err) { cb(err); return; }

			if (rows.length === 0) {
				const	err	= new Error('Could not find database row of newly saved image uuid: "' + data.uuid + '"');
				log.error('larvitimages: saveImage() - ' + err.message);
				cb(err);
				return;
			}

			clearCache({'slug': rows[0].slug}, cb);
		});
	});

	async.series(tasks, function(err) {
		// Something went wrong. Clean up and callback the error
		if (err) { cb(err); return; }

		// Re-read this entry from the database to be sure to get the right deal!
		getImages({'uuids': data.uuid}, function(err, images) {
			if (err) { cb(err); return; }
			cb(null, images[Object.keys(images)[0]]);
		});
	});
};

exports.clearCache	= clearCache;
exports.getPathToImage	= getPathToImage;
exports.getImageBin	= getImageBin;
exports.getImages	= getImages;
exports.rmImage	= rmImage;
exports.saveImage	= saveImage;
