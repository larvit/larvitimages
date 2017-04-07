'use strict';

const	topLogPrefix	= 'larvitimages: ./img.js - ',
	uuidValidate	= require('uuid-validate'),
	dataWriter	= require(__dirname + '/dataWriter.js'),
	imageType	= require('image-type'),
	intercom	= require('larvitutils').instances.intercom,
	uuidLib	= require('uuid'),
	mkdirp	= require('mkdirp'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	slug	= require('slug'),
	path	= require('path'),
	jimp	= require('jimp'),
	log	= require('winston'),
	os	= require('os'),
	fs	= require('fs-extra'),
	db	= require('larvitdb'),
	_	= require('lodash');

let	config;

if (fs.existsSync(__dirname + '/config/images.json')) {
	config	= require(__dirname + '/config/images.json');
} else {
	config = {};
}

if (config.cachePath !== undefined) {
	exports.cacheDir = config.cachePath;
} else {
	exports.cacheDir = os.tmpdir() + '/larvitimages_cache';
}

if (config.storagePath !== undefined) {
	exports.storagePath = config.storagePath;
} else {
	exports.storagePath = process.cwd() + '/larvitimages';
}

/**
 * Get path to image
 *
 * @param str	- 'd893b68d-bb64-40ac-bec7-14e640a235a6'
 *
 */
function getPathToImage(uuid, cache) {
	if (cache) {
		return exports.cacheDir + '/' + uuid.substr(0, 4).split('').join('/') + '/';
	} else {
		return	exports.storagePath + '/' + uuid.substr(0, 4).split('').join('/') + '/';
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
	const	logPrefix	= topLogPrefix + 'createImageDirectory() - ';

	let	path	= '';

	if (typeof cache === 'function') {
		cb	= cache;
		cache	= false;
	}

	// Check if storage path is defined and set it.
	if (exports.storagePath === undefined) return cb(new Error('No defined path for storing images.'));

	path = getPathToImage(uuid, cache);

	if ( ! uuidValidate(uuid, 4)) return cb(new Error('Invalid uuid'));

	if ( ! fs.existsSync(path)) {
		mkdirp(path, function (err) {
			if (err) {
				log.error(logPrefix + 'Could not create folder: "' + path + '" err: ' + err.message);
			} else {
				log.verbose(logPrefix + 'Folder "' + path + '" created');
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
	const	logPrefix	= topLogPrefix + 'clearCache() - ',
		tasks	= [];

	let	exists;

	if (typeof options === 'function') {
		cb	= options;
		options	= {};
	}

	if (Object.keys(options).length === 0) {
		options.clearAll = true;
	}

	if (typeof cb !== 'function') {
		cb	= function (){};
	}

	if (options.clearAll) {
		tasks.push(function (cb) {
			fs.stat(exports.cacheDir, function (err, stats) {
				if (err && err.code === 'ENOENT') {
					exists	= false;
					return cb();
				} else if (err) {
					log.error(logPrefix + 'Unknown error when fs.stat(' + exports.cacheDir + '): ' + err.message);
					return cb(err);
				}

				exists	= stats.isDirectory();
				cb();
			});
		});

		// Delete
		tasks.push(function (cb) {
			fs.remove(exports.cacheDir, cb);
		});
	} else {

		// if no uuid is given get image data by slug.
		if (options.uuid === undefined) {
			tasks.push(function (cb) {
				getImages({'slugs': [options.slug]}, function (err, image) {
					if (err) {
						log.warn(logPrefix + 'Could not run getImages(), err: ' + err.message);
						return cb(err);
					}

					if (Object.keys(image).length === 0) {
						log.warn(logPrefix + 'No image found in database with slug: ' +  options.slug);
						exists = false;
					} else {
						options.uuid = lUtils.formatUuid(image[Object.keys(image)[0]].uuid);
					}
					cb();
				});
			});
		}

		// Check if the folder exists at all
		tasks.push(function (cb) {
			if (exists === false) return cb();

			fs.stat(getPathToImage(options.uuid, true), function (err, stats) {
				if (err && err.code === 'ENOENT') {
					exists = false;
					return cb();
				} else if (err) {
					log.error(logPrefix + 'Unknown error when fs.stat(' + exports.cacheDir + '): ' + err.message);
					return cb(err);
				}

				exists	= stats.isDirectory();
				cb();
			});
		});

		// Remove files
		tasks.push(function (cb) {
			const	tasks	= [];

			if (exists === false) return cb();

			fs.readdir(getPathToImage(options.uuid, true), function (err, files) {
				if (err) {
					log.warn(logPrefix + 'Could not read dir for image uuid: "' + options.uuid + '", err: ' + err.message);
					return cb(err);
				}

				for (let i = 0; files[i] !== undefined; i ++) {
					const	fileName	= files[i];

					if (fileName.substring(0, options.uuid.length) === options.uuid) {
						tasks.push(function (cb) {
							fs.unlink(getPathToImage(options.uuid, true) + fileName, function (err) {
								if (err) {
									log.warn(logPrefix + 'Could not remove file: "' + fileName + '", err: ' + err.message);
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

function getImageBin(options, cb) {
	const	logPrefix	= topLogPrefix + 'getImageBin() - ';

	let	originalFile,
		cachedFile,
		fileToLoad,
		imgType,
		uuid;

	getImages({'slugs': options.slug}, function (err, images) {
		let	image;

		if (err) return cb(err);

		if (Object.keys(images).length === 0) {
			return cb();
		} else {
			image = images[Object.keys(images)[0]];
		}

		uuid	= image.uuid;
		imgType	=	image.type;
		originalFile	= getPathToImage(uuid, false) + uuid + '.' + imgType;
		cachedFile	= getPathToImage(uuid, true) + uuid; // imgType is added later
		fileToLoad	= originalFile; // Default to fetching the original file

		// If custom width and/or height, use cached file instead
		if (options.width || options.height) {
			if (options.width)	cachedFile += '_w' + options.width;
			if (options.height)	cachedFile += '_h' + options.height;
			cachedFile += '.' + imgType;
			fileToLoad = cachedFile;
		}

		// Check if cached file exists, and if so, return it
		function returnFile(cb) {
			fs.readFile(fileToLoad, function (err, fileBuf) {
				if (err || ! fileBuf) {
					createFile(function (err) {
						if (err) return cb(err);
						returnFile(cb);
					});
					return;
				}
				cb(null, fileBuf);
			});
		}

		function createFile(cb) {
			const	locLogPrefix	= logPrefix + 'createFile() - ';

			jimp.read(originalFile, function (err, image) {
				let	imgRatio,
					imgWidth,
					imgHeight;

				if (err) {
					log.warn(locLogPrefix + 'Could not read file "' + originalFile + '", err: ' + err.message);
					console.log(err);
					return cb(err);
				}

				if ( ! options.width && ! options.height) {
					const	err	= new Error('Cannot create new file without custom height or width. Should\'ve loaded the original file instead');
					log.warn(locLogPrefix + err.message);
					return cb(err);
				}

				imgWidth	= image.bitmap.width;
				imgHeight	= image.bitmap.height;
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
					log.warn(locLogPrefix + err.message);
					return cb(err);
				}

				image.resize(Number(options.width), Number(options.height), function (err, image) {
					if (err) {
						log.warn(locLogPrefix + 'Could not resize image, err: ' + err.message);
						return cb(err);
					}

					image.quality(90, function (err, image) {
						if (err) {
							log.warn(locLogPrefix + 'Could not set image quality to 90, err: ' + err.message);
							return cb(err);
						}

						mkdirp(path.dirname(cachedFile), function (err) {
							if (err && err.message.substring(0, 6) !== 'EEXIST') {
								log.warn(locLogPrefix + 'could not mkdirp "' + path.dirname(cachedFile) + '", err: ' + err.message);
								return cb(err);
							}

							image.write(cachedFile, function (err) {
								if (err) {
									log.warn(locLogPrefix + 'Could not save image, err: ' + err.message);
								}

								cb(err);
							});
						});
					});
				});
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
	const	logPrefix	= topLogPrefix + 'getImages() - ',
		dbFields	= [],
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
		_.each(options.slugs, function (slug, idx) {
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
				options.uuids[i] = lUtils.uuidToBuffer(options.uuids[i]);
			}
		}
	}

	log.debug(logPrefix + 'Called with options: "' + JSON.stringify(options) + '"');

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

	tasks.push(function (cb) {
		dataWriter.ready(cb);
	});

	// Get images
	tasks.push(function (cb) {
		let	sql	=	'SELECT images.uuid, images.slug, images.type\n';

		sql	+=	'FROM images_images as images\n';
		sql	+= generateWhere();
		sql	+= 'ORDER BY images.slug\n';

		if (options.limit) {
			sql += 'LIMIT ' + parseInt(options.limit) + '\n';
		}

		if (options.limit && options.offset !== undefined) {
			sql += ' OFFSET ' + parseInt(options.offset);
		}

		db.query(sql, dbFields, function (err, result) {
			for (let i = 0; result[i] !== undefined; i ++) {
				images[lUtils.formatUuid(result[i].uuid)] 	= result[i];
				images[lUtils.formatUuid(result[i].uuid)].uuid	= lUtils.formatUuid(result[i].uuid);
				images[result[i].uuid].metadata	= [];
			}
			cb(err);
		});
	});

	// Get metadata
	tasks.push(function (cb) {
		let	sql	= '';

		sql	+= 'SELECT * FROM images_images_metadata as metadata\n';
		sql	+= 'WHERE imageUuid IN (SELECT images.uuid FROM images_images as images ' + generateWhere() +  ')';

		db.query(sql, dbFields, function (err, result) {
			for (let i = 0; result[i] !== undefined; i ++) {
				result[i].imageUuid = lUtils.formatUuid(result[i].imageUuid);
				metadata.push(result[i]);
			}
			cb(err);
		});
	});

	async.series(tasks, function (err) {
		for (let i = 0; metadata[i] !== undefined; i ++) {
			const	imageUuid	= metadata[i].imageUuid;

			delete metadata[i].imageUuid;
			images[imageUuid].metadata.push(metadata[i]);
		}

		if (options.includeBinaryData) {
			const	subtasks	= [];

			for (let uuid in images) {
				subtasks.push(function (cb) {
					const	path = getPathToImage(uuid);

					if (err) return cb(err);

					fs.readFile(path + uuid + '.' + images[uuid].type, function (err, image) {
						if (err) return cb(err);
						images[uuid].image = image;
						cb();
					});
				});
			}

			async.parallel(subtasks, function (err) {
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

	tasks.push(function (cb) {
		dataWriter.ready(cb);
	});

	// Get slug
	tasks.push(function (cb) {
		db.query('SELECT * FROM images_images WHERE uuid = ?', [lUtils.uuidToBuffer(uuid)], function (err, rows) {
			if (err) return cb(err);

			if (rows.length > 0) {
				slug	= rows[0].slug;
				type = rows[0].type;
			}

			cb();
		});
	});

	// Delete data through queue
	tasks.push(function (cb) {
		const	options	= {'exchange': dataWriter.exchangeName},
			message	= {};

		message.action	= 'rmImage';
		message.params	= {};
		message.params.uuid	= uuid;

		intercom.send(message, options, function (err, msgUuid) {
			if (err) { cb(err); return; }

			dataWriter.emitter.once(msgUuid, cb);
		});
	});

	if (dataWriter.mode !== 'slave') {
		// Delete actual file
		tasks.push(function (cb) {
			fs.unlink(getPathToImage(uuid) + uuid + '.' + type, cb);
		});

		tasks.push(function (cb) {
			if ( ! slug) return cb();

			clearCache({'slug': slug}, cb);
		});
	}

	async.series(tasks, cb);
}

/**
 * Save an image
 *
 * @param obj data -	{
 *		'uuid':	d8d2bed2-4da1-4650-968c-7acc81b62c92,
 *		'slug':	'barfoo'
 *		'file':	File obj from formidable, see https://github.com/felixge/node-formidable#formidablefile for more info
 *		'metadata':	[
 *				{
 *					'name': 'deer',
 *					'data': 'tasty'
 *				},
 *				{
 *					'name': 'frog',
 *					'data': 'disgusting'
 *				}
 *			] - Optional
 *	}
 * @param func cb(err, image) - the image will be a row from getImages()
 */
function saveImage(data, cb) {
	const	logPrefix	= topLogPrefix + 'saveImage() - ',
		tasks	= [];

	let	tmpFilePath;

	log.verbose(logPrefix + 'Running with data. "' + JSON.stringify(data) + '"');

	// If id is missing, we MUST have a file
	if (data.uuid === undefined && data.file === undefined) {
		log.info(logPrefix + 'Upload file is missing, but required since no ID is supplied.');
		return cb(new Error('Image file is required'));
	}

	tasks.push(function (cb) {
		dataWriter.ready(cb);
	});

	// If we have an image file, make sure the format is correct
	if (data.file !== undefined) {
		if ( ! data.file.bin && data.file.path) {
			// Read binary data if it is not read already

			tasks.push(function (cb) {
				fs.readFile(data.file.path, function (err, result) {
					data.file.bin	= result;
					cb(err);
				});
			});

		} else if (data.file.bin && ! data.file.path) {
			// Save bin data to temp file if no path was provided

			tmpFilePath = os.tmpdir() + '/' + uuidLib.v1();

			tasks.push(function (cb) {
				fs.writeFile(tmpFilePath, data.file.bin, function (err) {
					if (err) {
						log.warn(logPrefix + 'Could not write to tmpFilePath: "' + tmpFilePath + '", err: ' + err.message);
					}
					cb(err);
				});
			});

		} else {
			const	err	= new Error('Either binary data or file path was given, can not save');
			log.warn(logPrefix + err.message);
			return cb(err);
		}

		tasks.push(function (cb) {
			let	filePath;

			if (tmpFilePath) {
				filePath = tmpFilePath;
			} else {
				filePath	= data.file.path;
			}

			// As a first step, check the mime type, since this is already given to us
			if (imageType(data.file.bin).mime !== 'image/png' && imageType(data.file.bin).mime !== 'image/jpeg' && imageType(data.file.bin).mime !== 'image/gif') {
				log.info(logPrefix + 'Invalid mime type "' + data.uploadedFile.type + '" for uploaded file.');
				return cb(new Error('Invalid file format, must be of image type PNG, JPEG or GIF'));
			}

			// Then actually checks so the file loads in our image lib
			jimp.read(filePath, function (err) {
				if (err) {
					log.warn(logPrefix + 'Unable to open uploaded file: ' + err.message);
				}

				cb(err);
			});
		});

		// Set image type
		tasks.push(function (cb) {
			data.file.type = imageType(data.file.bin).ext;
			cb();
		});
	}

	// Set the slug if needed
	tasks.push(function (cb) {
		const	dbFields	= [];

		let	sql;

		// If no slug or uuid was supplied use the filename as base for the slug
		if ( ! data.uuid && ! data.slug) {
			data.slug = data.file.name;
		}

		// If no slug is set by here, it means an id is supplied and the slug
		// should not change in the database, no need to check anything more here
		if ( ! data.slug) {
			return cb();
		} else {
			data.slug	= slug(data.slug, {'save': ['.', '/']});
			data.slug	= _.trim(data.slug, '/');
		}

		// Make sure it is not occupied by another image
		sql = 'SELECT uuid FROM images_images WHERE slug = ?';
		dbFields.push(data.slug);
		if (data.uuid !== undefined) {
			sql += ' AND uuid != ?';
			dbFields.push(lUtils.uuidToBuffer(data.uuid));
		}

		db.query(sql, dbFields, function (err, rows) {
			if (err) return cb(err);

			if (rows.length) {
				return cb(new Error('Slug is used by another image entry, try setting another one manually.'));
			}

			cb();
		});
	});

	// Save database data through queue
	tasks.push(function (cb) {
		const	options	= {'exchange': dataWriter.exchangeName},
			message	= {};

		message.action	= 'saveImage';
		message.params	= {};

		if (data.uuid === undefined) {
			data.uuid	= uuidLib.v4();
		}

		message.params.data = data;

		intercom.send(message, options, function (err, msgUuid) {
			if (err) { cb(err); return; }

			dataWriter.emitter.once(msgUuid, cb);
		});
	});

	// Save file data
	if (data.file) {
		tasks.push(function (cb) {
			createImageDirectory(data.uuid, function (err, path) {
				if (err) return cb(err);
				fs.writeFile(path + data.uuid + '.' + data.file.type, data.file.bin, function (err) {
					if (err) return cb(err);
					cb();
				});
			});
		});
	}

	// Clear cache for this slug
	tasks.push(function (cb) {
		db.query('SELECT slug FROM images_images WHERE uuid = ?', [lUtils.uuidToBuffer(data.uuid)], function (err, rows) {
			if (err) return cb(err);

			if (rows.length === 0) {
				const	err	= new Error('Could not find database row of newly saved image uuid: "' + data.uuid + '"');
				log.error(logPrefix + '' + err.message);
				return cb(err);
			}

			clearCache({'slug': rows[0].slug}, cb);
		});
	});

	// Remove temporary file
	tasks.push(function (cb) {
		if (tmpFilePath === undefined) return cb();

		fs.unlink(tmpFilePath, function (err) {
			if (err) {
				log.warn(logPrefix + 'Could not remove tmpFilePath "' + tmpFilePath + '", err: ' + err.message);
			}

			cb(err);
		});
	});

	async.series(tasks, function (err) {
		// Something went wrong. Clean up and callback the error
		if (err) return cb(err);

		// Re-read this entry from the database to be sure to get the right deal!
		getImages({'uuids': data.uuid}, function (err, images) {
			if (err) return cb(err);

			cb(null, images[Object.keys(images)[0]]);
		});
	});
};

exports.clearCache	= clearCache;
exports.dataWriter	= dataWriter;
exports.getImageBin	= getImageBin;
exports.getImages	= getImages;
exports.getPathToImage	= getPathToImage;
exports.rmImage	= rmImage;
exports.saveImage	= saveImage;
