'use strict';

const	uuidValidate	= require('uuid-validate'),
	imageType	= require('image-type'),
	uuidLib	= require('node-uuid'),
	slugify	= require('larvitslugify'),
	events	= require('events'),
	mkdirp	= require('mkdirp'),
	async	= require('async'),
	utils	= require('larvitutils'),
	mime	= require('mime-types'),
	path	= require('path'),
	lwip	= require('lwip'),
	log	= require('winston'),
	os	= require('os'),
	fs	= require('fs'),
	db	= require('larvitdb'),
	_	= require('lodash');

let	eventEmitter	= new events.EventEmitter(),
	dbChecked	= false,
	config	= require(__dirname + '/config/images.json');

exports.cacheDir = os.tmpdir() + '/larvitimages_cache_' + process.pid;


/**
 * Get path to image
 *
 * @param str	- 'd893b68d-bb64-40ac-bec7-14e640a235a6,d893b68d-bb64-40ac-bec7-14e640a235a6'
 *
 */
function getPathToImage(uuid) {
	return config.storage + uuid.substr(0, 4).split('').join('/') + '/';
}

/**
 * Get path to image
 *
 * @param str	- 'd893b68d-bb64-40ac-bec7-14e640a235a6,d893b68d-bb64-40ac-bec7-14e640a235a6'
 * @param func cb	- callback(err, path)
 *
 */
function createImageDirectory(uuid, cb) {
	let	path	= config.storage + uuid.substr(0, 4).split('').join('/') + '/';

	if ( ! uuidValidate(uuid, 4)) { cb(new Error('Invalid uuid')); return; }
	if ( ! fs.existsSync(path)) {
		mkdirp(path, function(err) {
			if (err) { cb(err); return; }
			cb(null, path);
		});
	}
}

function clearCache(slug, cb) {
	const	tasks	= [];

	let	exists;

	if (typeof slug === 'function') {
		cb	= slug;
		slug	= undefined;
	}

	if (slug === undefined) {
		slug	= '';
	}

	if (typeof cb !== 'function') {
		cb	= function(){};
	}

	// Check if the folder exists at all
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

	// Remove files
	tasks.push(function(cb) {
		const	tasks	= [];

		if (exists === false) {
			cb();
			return;
		}

		fs.readdir(exports.cacheDir, function(err, files) {
			if (err) { cb(err); return; }

			for (let i = 0; files[i] !== undefined; i ++) {
				const	fileName	= files[i];

				if (slug === '' || fileName.substring(0, slug.length) === slug) {
					tasks.push(function(cb) {
						fs.unlink(exports.cacheDir + '/' + fileName, function(err) {
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

	// Create the folder if it did not exist
	tasks.push(function(cb) {
		if (exists) {
			cb();
			return;
		}

		createCacheFolder(cb);
	});

	async.series(tasks, cb);
}

function createCacheFolder(cb) {
	if (typeof cb !== 'function') {
		cb = function() {};
	}

	mkdirp(exports.cacheDir, function(err) {
		if (err) {
			log.error('larvitimages: createCacheFolder() - Could not create cache folder: "' + exports.cacheDir + '" err: ' + err.message);
		} else {
			log.verbose('larvitimages: createCacheFolder() - Cache folder "' + exports.cacheDir + '" created');
		}

		cb(err);
	});
}

createCacheFolder();

// Create database tables if they are missing
function createTablesIfNotExists(cb) {
	const	sql	= 'CREATE TABLE IF NOT EXISTS `images_images` (`uuid` binary(16) NOT NULL, `slug` varchar(255) CHARACTER SET ascii NOT NULL, `type` varchar(255) CHARACTER SET ascii NOT NULL, PRIMARY KEY (`uuid`), UNIQUE KEY `slug` (`slug`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';

	db.query(sql, function(err) {
		if (err) { cb(err); return; }
		dbChecked = true;
		eventEmitter.emit('checked');
	});
}
createTablesIfNotExists(function(err) {
	log.error('larvitimages: createTablesIfNotExists() - Database error: ' + err.message);
});

function getImageBin(options, cb) {
	let	cachedFile	= exports.cacheDir + '/' + options.slug;

	if (options.width)	cachedFile += '_w' + options.width;
	if (options.height)	cachedFile += '_h' + options.height;

	// Check if cached file exists, and if so, return it
	function returnFile(cb) {
		fs.readFile(cachedFile, function(err, fileBuf) {
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
		getImages({'slugs': options.slug, 'includeBinaryData': true}, function(err, images) {
			let	imgRatio,
				imgType,
				imgMime;

			if (err) { cb(err); return; }

			if (images.length === 0) {
				cb(new Error('File not found'));
				return;
			}

			imgMime = mime.lookup(options.slug) || 'application/octet-stream';
			if (imgMime === 'image/png') {
				imgType = 'png';
			} else if (imgMime === 'image/jpeg') {
				imgType = 'jpg';
			} else if (imgMime === 'image/gif') {
				imgType = 'gif';
			} else {
				imgType = false;
			}

			if (options.width || options.height) {
				lwip.open(images[0].image, imgType, function(err, lwipImage) {
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

					if ( ! utils.isInt(options.height) || ! utils.isInt(options.width)) {
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
	const	dbFields = [];

	let	sql;

	if (typeof options === 'function') {
		cb	= options;
		options	= {};
	}

	log.debug('larvitimages: getImages() - Called with options: "' + JSON.stringify(options) + '"');

	// Make sure options that should be arrays actually are arrays
	// This will simplify our lives in the SQL builder below
	if (options.uuids !== undefined && ! (options.uuids instanceof Array)) {
		options.uuids = [options.uids];
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

	// Make sure the database tables exists before going further!
	if ( ! dbChecked) {
		log.debug('larvitimages: getImages() - Database not checked, rerunning this method when event have been emitted.');
		eventEmitter.on('checked', function() {
			log.debug('larvitimages: getImages() - Database check event received, rerunning getImages().');
			getImages(options, cb);
		});

		return;
	}

	sql =	'SELECT uuid, slug, type';
	sql +=	'	FROM images_images\n';
	sql +=	'WHERE 1 + 1\n';

	// Only get posts with the current slugs
	if (options.slugs !== undefined) {
		sql += '	AND (slug IN (';

		for (let i = 0; options.slugs[i] !== undefined; i ++) {
			sql += '?,';
			dbFields.push(options.slugs[i]);
		}

		// Select by slug without file ending
		sql = sql.substring(0, sql.length - 1) + ') OR SUBSTRING(slug, 1, CHAR_LENGTH(slug) - 1 - CHAR_LENGTH(SUBSTRING_INDEX(slug, \'.\', -1))) IN (';

		for (let i = 0; options.slugs[i] !== undefined; i ++) {
			sql += '?,';
			dbFields.push(options.slugs[i]);
		}

		sql = sql.substring(0, sql.length - 1) + '))\n';
	}

	// Only get posts with given ids
	if (options.uuids !== undefined) {
		sql += '	AND uuid IN (';

		for (let i = 0; options.uuids[i] !== undefined; i ++) {
			sql += '?,';
			dbFields.push(options.uuids[i]);
		}

		sql = sql.substring(0, sql.length - 1) + ')\n';
	}

	sql += 'ORDER BY slug\n';

	if (options.limit) {
		sql += 'LIMIT ' + parseInt(options.limit) + '\n';
	}

	if (options.limit && options.offset !== undefined) {
		sql += ' OFFSET ' + parseInt(options.offset);
	}

	db.query(sql, dbFields, function(err, result) {
		let tasks = [];
		if (options.includeBinaryData) {
			for (let i = 0; result[i] !== undefined; i ++) {
				tasks.push(function(cb) {
					let	uuid = uuidLib.unparse(result[i].uuid),
						path = getPathToImage(uuid);

						if (err) { cb(err); return; }
						fs.readFile(path + uuid + '.' + result[i].type, function(err, image) {
							if (err) { cb(err); return; }
							result[i].image = image;
							cb();
						});
				});
			}
		}
		async.series(tasks, function(err) {
			cb(err, result);
		});

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

	// Delete actual file
	tasks.push(function(cb) {
		fs.unlink(getPathToImage(uuid) + uuid + '.' + type, cb);
	});

	tasks.push(function(cb) {
		if ( ! slug) {
			cb();
			return;
		}

		clearCache(slug, cb);
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

	// Set the slug if need be
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

			clearCache(rows[0].slug, cb);
		});
	});

	async.series(tasks, function(err) {
		// Something went wrong. Clean up and callback the error
		if (err) { cb(err); return; }

		// Re-read this entry from the database to be sure to get the right deal!
		getImages({'ids': data.uuid}, function(err, images) {
			if (err) { cb(err); return; }

			cb(null, images[0]);
		});
	});
};

exports.clearCache	= clearCache;
exports.getImageBin	= getImageBin;
exports.getImages	= getImages;
exports.rmImage	= rmImage;
exports.saveImage	= saveImage;
