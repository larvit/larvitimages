'use strict';

const	slugify	= require('larvitslugify'),
	events	= require('events'),
	rimraf	= require('rimraf'),
	mkdirp	= require('mkdirp'),
	async	= require('async'),
	mime	= require('mime-types'),
	path	= require('path'),
	lwip	= require('lwip'),
	log	= require('winston'),
	os	= require('os'),
	fs	= require('fs'),
	db	= require('larvitdb'),
	_	= require('lodash');

let	eventEmitter	= new events.EventEmitter(),
	dbChecked	= false;

exports.cacheDir = os.tmpdir() + '/larvitimages_cache_' + process.pid;

function clearCache(cb) {
	const	tasks	= [];

	let	exists;

	if (typeof cb !== 'function') {
		cb = function(){};
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

	// Remove old folder
	tasks.push(function(cb) {
		if (exists) {
			rimraf(exports.cacheDir, function(err) {
				if (err) {
					log.error('larvitimages: clearCache() - Could not remove cache folder: "' + exports.cacheDir + '"');
				}

				cb(err);
			});
		} else {
			cb();
		}
	});

	// Create the new one
	tasks.push(function(cb) {
		mkdirp(exports.cacheDir, function(err) {
			if (err) {
				log.error('larvitimages: clearCache() - Could not create cache folder: "' + exports.cacheDir + '"');
				cb(err);
				return;
			}

			log.verbose('larvitimages: clearCache() - Cache folder "' + exports.cacheDir + '" created');
			cb();
		});
	});

	async.series(tasks, cb);
}
clearCache(); // Clear possible other cache and recreate the cache folder

// Create database tables if they are missing
function createTablesIfNotExists(cb) {
	const	sql	= 'CREATE TABLE IF NOT EXISTS `images_images` (`id` int(10) unsigned NOT NULL AUTO_INCREMENT, `slug` varchar(255) CHARACTER SET ascii NOT NULL, `image` longblob NOT NULL, PRIMARY KEY (`id`), UNIQUE KEY `slug` (`slug`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';

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

					lwipImage.batch()
						.resize(parseInt(options.width), parseInt(options.height))
						.toBuffer(imgType, {}, function(err, imgBuf) {
							if (err) {
								log.warn('larvitimages: getImageBin() - createFile() - Error from lwip: ' + err.message);
								cb(err);
								return;
							}

							mkdirp(path.dirname(cachedFile), function(err) {
								if (err) {
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
					if (err) {
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
 *		'ids':	[32,4],	//
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
	if (options.ids !== undefined && ! (options.ids instanceof Array)) {
		options.ids = [options.ids];
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
	if (options.ids instanceof Array && options.ids.length === 0) {
		options.ids.push(- 1);
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

	sql	= 'SELECT id, slug';

	if (options.includeBinaryData) {
		sql += ', image';
	}

	sql += '	FROM images_images\n';
	sql += 'WHERE 1 + 1\n';

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
	if (options.ids !== undefined) {
		sql += '	AND id IN (';

		for (let i = 0; options.ids[i] !== undefined; i ++) {
			sql += '?,';
			dbFields.push(options.ids[i]);
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

	db.query(sql, dbFields, cb);
};

function rmImage(id, cb) {
	const	tasks	= [];

	tasks.push(function(cb) {
		db.query('DELETE FROM images_images WHERE id = ?', [id], cb);
	});

	tasks.push(clearCache);

	async.parallel(tasks, cb);
}

/**
 * Save an image
 *
 * @param obj data -	{
 *		'id':	1323,
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
	if (data.id === undefined && data.uploadedFile === undefined) {
		log.info('larvitimages: saveImage() - Upload file is missing, but required since no ID is supplied.');
		cb(new Error('Image file is required'));
		return;
	}

	// If we have an image file, make sure the format is correct
	if (data.uploadedFile !== undefined) {
		tasks.push(function(cb) {

			// As a first step, check the mime type, since this is already given to us
			if (data.uploadedFile.type !== 'image/png' && data.uploadedFile.type !== 'image/jpeg' && data.uploadedFile.type !== 'image/gif') {
				log.info('larvitimages: saveImage() - Invalid mime type "' + data.uploadedFile.type + '" for uploaded file.');
				cb(new Error('Invalid file format, must be of image type PNG, JPEG or GIF'));
				return;
			}

			// Then actually checks so the file loads in our image lib
			lwip.open(data.uploadedFile.path, function(err) {
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

		// If no slug or id was supplied use the filename as base for the slug
		if ( ! data.id && ! data.slug) {
			data.slug = data.uploadedFile.name;
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
		sql = 'SELECT id FROM images_images WHERE slug = ?';
		dbFields.push(data.slug);
		if (data.id !== undefined) {
			sql += ' AND id != ?';
			dbFields.push(data.id);
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

	// Create a new image if id is not set
	if (data.id === undefined) {
		tasks.push(function(cb) {
			const	sql	= 'INSERT INTO images_images (slug) VALUES(?);',
				dbFields	= [data.slug];

			db.query(sql, dbFields, function(err, result) {
				if (err) { cb(err); return; }

				log.debug('larvitimages: saveImage() - New image created with id: "' + result.insertId + '"');
				data.id = result.insertId;
				cb();
			});
		});
	}

	// Save file data
	if (data.uploadedFile) {
		tasks.push(function(cb) {
			const	sql	= 'UPDATE images_images SET image = ? WHERE id = ?;',
				dbFields	= [];

			fs.readFile(data.uploadedFile.path, function(err, fileData) {
				if (err) {
					log.error('larvitimages: saveImage() - Could not read upladed image data from ' + data.uploadedFile.path);
					cb(err);
					return;
				}

				dbFields.push(fileData);
				dbFields.push(data.id);

				db.query(sql, dbFields, cb);
			});
		});

		tasks.push(clearCache);
	}

	// Save the slug
	if (data.slug) {
		tasks.push(function(cb) {
			db.query('UPDATE images_images SET slug = ? WHERE id = ?', [data.slug, data.id], cb);
		});
	}

	async.series(tasks, function(err) {
		// Something went wrong. Clean up and callback the error
		if (err) { cb(err); return; }

		// Re-read this entry from the database to be sure to get the right deal!
		getImages({'ids': data.id}, function(err, images) {
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
