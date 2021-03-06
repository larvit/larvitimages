'use strict';

const	topLogPrefix	= 'larvitimages: index.js: ',
	DataWriter	= require(__dirname + '/dataWriter.js'),
	imageType	= require('image-type'),
	Intercom	= require('larvitamintercom'),
	uuidLib	= require('uuid'),
	mkdirp	= require('mkdirp'),
	LUtils	= require('larvitutils'),
	lUtils	= new LUtils(),
	async	= require('async'),
	slug	= require('larvitslugify'),
	path	= require('path'),
	jimp	= require('jimp'),
	os	= require('os'),
	fs	= require('fs-extra'),
	_	= require('lodash');

function Img(options, cb) {
	const	logPrefix	= topLogPrefix + 'Img() - ',
		that	= this;

	that.options	= options || {};

	if ( ! that.options.db) {
		throw new Error('Required option db is missing');
	}
	that.db	= that.options.db;

	if ( ! that.options.log) {
		that.options.log	= new lUtils.Log();
	}
	that.log	= that.options.log;

	if ( ! that.options.cacheDir) {
		that.options.cacheDir	= os.tmpdir() + '/larvitimages_cache';
	}
	that.cacheDir	= that.options.cacheDir;

	if ( ! that.options.storagePath) {
		that.options.storagePath	= process.cwd() + '/larvitimages';
	}
	that.storagePath	= that.options.storagePath;

	if ( ! that.options.exchangeName) {
		that.options.exchangeName	= 'larvitimages';
	}

	if ( ! that.options.mode) {
		that.log.info(logPrefix + 'No "mode" option given, defaulting to "noSync"');
		that.options.mode	= 'noSync';
	} else if (['noSync', 'master', 'slave'].indexOf(that.options.mode) === - 1) {
		const	err	= new Error('Invalid "mode" option given: "' + that.options.mode + '"');
		that.log.error(logPrefix + err.message);
		throw err;
	}

	if ( ! that.options.intercom) {
		that.log.info(logPrefix + 'No "intercom" option given, defaulting to "loopback interface"');
		that.options.intercom	= new Intercom('loopback interface');
	}

	that.dataWriter	= new DataWriter({
		'exchangeName':	that.options.exchangeName,
		'intercom':	that.options.intercom,
		'mode':	that.options.mode,
		'log':	that.options.log,
		'db':	that.db,
		'amsync_host':	that.options.amsync_host || null,
		'amsync_minPort':	that.options.amsync_minPort || null,
		'amsync_maxPort':	that.options.amsync_maxPort || null
	}, cb);
}

/**
 * Get path to image
 *
 * @param str	- 'd893b68d-bb64-40ac-bec7-14e640a235a6'
 * @return str
 */
Img.prototype.getPathToImage = function getPathToImage(uuid, cache) {
	const that	= this;

	if ( ! uuid || typeof uuid !== 'string') return false;

	if (cache) {
		return that.cacheDir + '/' + uuid.substr(0, 4).split('').join('/') + '/';
	} else {
		return that.storagePath + '/' + uuid.substr(0, 4).split('').join('/') + '/';
	}
};

/**
 * Get path to image
 *
 * @param str uuid 	- 'd893b68d-bb64-40ac-bec7-14e640a235a6'
 * @param bool cache	- true/false // optional
 * @param func cb	- callback(err, path)
 *
 */
Img.prototype.createImageDirectory = function createImageDirectory(uuid, cache, cb) {
	const	logPrefix	= topLogPrefix + 'createImageDirectory() - ',
		that	= this;

	let	path	= '';

	if (typeof cache === 'function') {
		cb	= cache;
		cache	= false;
	}

	// Check if storage path is defined and set it.
	if (that.storagePath === undefined) {
		const	err	 = new Error('No defined path for storing images.');
		that.log.warn(logPrefix + err.message);
		return cb(err);
	}

	if (String(uuid).match(/^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$/) === null) {
		const	err	= new Error('Invalid uuid');
		that.log.warn(logPrefix + err.message);
		return cb(err);
	}

	path	= that.getPathToImage(uuid, cache);

	if (path === false) {
		const	err	= new Error('Could not get path to file with uuid: "' + uuid + '"');
		that.log.warn(logPrefix + err.message);
		return cb(err);
	}

	if ( ! fs.existsSync(path)) {
		mkdirp(path, function (err) {
			if (err) {
				that.log.error(logPrefix + 'Could not create folder: "' + path + '" err: ' + err.message);
			} else {
				that.log.debug(logPrefix + 'Folder "' + path + '" created');
			}

			cb(err, path);
		});
	} else {
		cb(null, path);
	}
};

/**
 * Clear Cache
 *
 * @param obj options -	{ // All options are optional!
 *		'slug':	'slug'	// As string
 *		'uuid':	'd893b68d-bb64-40ac-bec7-14e640a235a6'	// As string
 *		'clearAll':	boolean	// If true it clears all cache. Options object empty = true
 *	}
 * @param func cb - callback(err)
 */
Img.prototype.clearCache = function clearCache(options, cb) {
	const	logPrefix	= topLogPrefix + 'clearCache() - ',
		tasks	= [],
		that	= this;

	let	exists;

	if (typeof options === 'function') {
		cb	= options;
		options	= {};
	}

	if (Object.keys(options).length === 0) {
		options.clearAll	= true;
	}

	if (typeof cb !== 'function') {
		cb	= function () {};
	}

	if (options.clearAll) {
		tasks.push(function (cb) {
			fs.stat(that.cacheDir, function (err, stats) {
				if (err && err.code === 'ENOENT') {
					exists	= false;
					return cb();
				} else if (err) {
					that.log.error(logPrefix + 'Unknown error when fs.stat(' + that.cacheDir + '): ' + err.message);
					return cb(err);
				}

				exists	= stats.isDirectory();
				cb();
			});
		});

		// Delete
		tasks.push(function (cb) {
			fs.remove(that.cacheDir, cb);
		});
	} else {

		// If no uuid is given get image data by slug.
		if (options.uuid === undefined) {
			tasks.push(function (cb) {
				that.getImages({'slugs': [options.slug]}, function (err, image) {
					if (err) {
						that.log.warn(logPrefix + 'Could not run getImages(), err: ' + err.message);
						return cb(err);
					}

					if (Object.keys(image).length === 0) {
						that.log.warn(logPrefix + 'No image found in database with slug: ' +  options.slug);
						exists = false;
					} else {
						options.uuid	= lUtils.formatUuid(image[Object.keys(image)[0]].uuid);
					}
					cb();
				});
			});
		}

		// Check if the folder exists at all
		tasks.push(function (cb) {
			let path;

			if (exists === false) return cb();

			path	= that.getPathToImage(options.uuid, true);

			if (path === false) {
				const	err	= new Error('Could not get path to file with uuid "' + uuid + '"');
				that.log.warn(logPrefix + err.message);
				return cb(err);
			}

			fs.stat(path, function (err, stats) {
				if (err && err.code === 'ENOENT') {
					exists	= false;
					return cb();
				} else if (err) {
					that.log.error(logPrefix + 'Unknown error when fs.stat(' + that.cacheDir + '): ' + err.message);
					return cb(err);
				}

				exists	= stats.isDirectory();
				cb();
			});
		});

		// Remove files
		tasks.push(function (cb) {
			const	tasks	= [];

			let	path;

			if (exists === false) return cb();

			path	= that.getPathToImage(options.uuid, true);

			if (path === false) {
				const	err	= new Error('Could not get path to file with uuid "' + uuid + '"');
				that.log.warn(logPrefix + err.message);
				return cb(err);
			}

			fs.readdir(path, function (err, files) {
				if (err) {
					that.log.warn(logPrefix + 'Could not read dir for image uuid: "' + options.uuid + '", err: ' + err.message);
					return cb(err);
				}

				for (let i = 0; files[i] !== undefined; i ++) {
					const	fileName	= files[i];

					if (fileName.substring(0, options.uuid.length) === options.uuid) {
						tasks.push(function (cb) {
							fs.unlink(path + fileName, function (err) {
								if (err) {
									that.log.warn(logPrefix + 'Could not remove file: "' + fileName + '", err: ' + err.message);
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
};

Img.prototype.getImageBin = function getImageBin(options, cb) {
	const	logPrefix	= topLogPrefix + 'getImageBin() - ',
		that	= this;

	let	originalFile,
		cachedFile,
		fileToLoad,
		imgType,
		uuid;

	that.getImages({'slugs': options.slug}, function (err, images) {
		let	image,
			oPath,
			cPath;

		if (err) return cb(err);

		if (Object.keys(images).length === 0) {
			return cb();
		} else {
			image	= images[Object.keys(images)[0]];
		}

		oPath	= that.getPathToImage(image.uuid, false);
		cPath	= that.getPathToImage(image.uuid, true);

		if (oPath === false || cPath === false) {
			const	err	= new Error('Could not get path to file with uuid "' + image.uuid + '"');
			that.log.warn(logPrefix + err.message);
			return cb(err);
		}

		uuid	= image.uuid;
		imgType	=	image.type;
		originalFile	= oPath + uuid + '.' + imgType;
		cachedFile	= cPath + uuid; // imgType is added later
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
				cb(null, fileBuf, fileToLoad);
			});
		}

		function createFile(cb) {
			const	locLogPrefix	= logPrefix + 'createFile() - ';

			jimp.read(originalFile, function (err, image) {
				let	imgRatio,
					imgWidth,
					imgHeight;

				if (err) {
					that.log.warn(locLogPrefix + 'Could not read file "' + originalFile + '", err: ' + err.message);
					return cb(err);
				}

				if ( ! options.width && ! options.height) {
					const	err	= new Error('Cannot create new file without custom height or width. Should\'ve loaded the original file instead');
					that.log.warn(locLogPrefix + err.message);
					return cb(err);
				}

				imgWidth	= image.bitmap.width;
				imgHeight	= image.bitmap.height;
				imgRatio	= imgWidth / imgHeight;

				// Set the missing height or width if only one is given
				if (options.width && ! options.height) {
					options.height	= Math.round(options.width / imgRatio);
				}

				if (options.height && ! options.width) {
					options.width	= Math.round(options.height * imgRatio);
				}

				if ( ! lUtils.isInt(options.height) || ! lUtils.isInt(options.width)) {
					const	err	= new Error('Options.height or options.width is not an integer. Options: ' + JSON.stringify(options));
					that.log.warn(locLogPrefix + err.message);
					return cb(err);
				}

				image.resize(Number(options.width), Number(options.height), function (err, image) {
					if (err) {
						that.log.warn(locLogPrefix + 'Could not resize image, err: ' + err.message);
						return cb(err);
					}

					image.quality(90, function (err, image) {
						if (err) {
							that.log.warn(locLogPrefix + 'Could not set image quality to 90, err: ' + err.message);
							return cb(err);
						}

						mkdirp(path.dirname(cachedFile), function (err) {
							if (err && err.message.substring(0, 6) !== 'EEXIST') {
								that.log.warn(locLogPrefix + 'could not mkdirp "' + path.dirname(cachedFile) + '", err: ' + err.message);
								return cb(err);
							}

							image.write(cachedFile, function (err) {
								if (err) {
									that.log.warn(locLogPrefix + 'Could not save image, err: ' + err.message);
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
};

/**
 * Get images
 *
 * @param obj options -	{ // All options are optional!
 *		'slugs':	['blu', 'bla'],	// With or without file ending
 *		'uuids':	[d893b68d-bb64-40ac-bec7-14e640a235a6,d893b68d-bb64-40ac-bec7-14e640a235a6],	//
 *		'metadata':	{'name': 'data', 'another-name': 'another-value'}
 *		'limit':	10,	// Defaults to 10, explicitly give false for no limit
 *		'offset':	20,	//
 *		'includeBinaryData':	true	// Defaults to false
 *	}
 * @param func cb - callback(err, images)
 */
Img.prototype.getImages = function getImages(options, cb) {
	const	logPrefix	= topLogPrefix + 'getImages() - ',
		metadata	= [],
		images	= {},
		tasks	= [],
		that	= this;

	if (typeof options === 'function') {
		cb	= options;
		options	= {};
	}

	// Make sure options that should be arrays actually are arrays
	// This will simplify our lives in the SQL builder below
	if (options.uuids !== undefined && ! (options.uuids instanceof Array)) {
		options.uuids	= [options.uuids];
	}

	if (options.slugs !== undefined && ! (options.slugs instanceof Array)) {
		options.slugs	= [options.slugs];
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
		options.limit	= 10;
	}

	// Convert uuids to buffers
	if (options.uuids !== undefined) {
		for (let i = 0; options.uuids[i] !== undefined; i ++) {
			if ( ! (options.uuids[i] instanceof Buffer))  {
				options.uuids[i] = lUtils.uuidToBuffer(options.uuids[i]);
			}
		}
	}

	that.log.debug(logPrefix + 'Called with options: "' + JSON.stringify(options) + '"');

	function generateWhere(dbFields) {
		let	sql	= '';

		sql +=	'WHERE 1 + 1\n';

		if (options.q !== undefined) {
			sql += ' AND (\n';
			sql += '   uuid IN (SELECT imageUuid FROM images_images_metadata WHERE data LIKE ?)\n';
			sql += '   OR slug LIKE ?\n';
			sql += ')\n';
			dbFields.push('%' + options.q + '%');
			dbFields.push('%' + options.q + '%');
		}

		// Only get images with the current slugs
		if (options.slugs !== undefined) {
			if (options.slugs.length === 0) {
				return 'WHERE 1 = 2\n';
			}

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

			sql	= sql.substring(0, sql.length - 1) + '))\n';
		}

		// Only get posts with given ids
		if (options.uuids !== undefined) {
			sql += '	AND images.uuid IN (';
			for (let i = 0; options.uuids[i] !== undefined; i ++) {
				if (Buffer.isBuffer(options.uuids[i])) {
					sql += '?,';
					dbFields.push(options.uuids[i]);
				} else {
					const	uuid	= lUtils.uuidToBuffer(options.uuids[i]);

					if (uuid !== false) {
						sql += '?,';
						dbFields.push(uuid);
					} else {
						sql += '?,';
						dbFields.push('no match due to bad uuid');
					}
				}
			}

			sql	= sql.substring(0, sql.length - 1) + ')\n';
		}

		return sql;
	}

	tasks.push(function (cb) {
		that.dataWriter.ready(cb);
	});

	// Get images
	tasks.push(function (cb) {
		const dbFields = [];

		let	sql	=	'SELECT images.uuid, images.slug, images.type\n';

		sql	+=	'FROM images_images as images\n';

		// Join on metadata
		if (options.metadata && Object.keys(options.metadata).length) {
			if (Object.keys(options.metadata).length > 60) {
				const err = new Error('Can not select on more than a total of 60 metadata key value pairs due to database limitation in joins');

				that.log.warn(logPrefix + err.message);

				return cb(err);
			}

			let counter = 0;

			for (const name of Object.keys(options.metadata)) {
				const value = options.metadata[name],
					uniqueMetadataName = 'metadata' + (++ counter);

				sql += 'JOIN images_images_metadata as ' + uniqueMetadataName;
				sql += ' ON images.uuid = ' + uniqueMetadataName + '.imageUuid';
				sql += ' AND ' + uniqueMetadataName + '.name = ?';
				sql += ' AND ' + uniqueMetadataName + '.data = ?';
				sql += '\n';

				dbFields.push(name);
				dbFields.push(value);
			}
		}

		sql += generateWhere(dbFields);
		sql	+= 'ORDER BY images.slug\n';

		if (options.limit) {
			sql += 'LIMIT ' + parseInt(options.limit) + '\n';
		}

		if (options.limit && options.offset !== undefined) {
			sql += ' OFFSET ' + parseInt(options.offset);
		}

		that.db.query(sql, dbFields, function (err, result) {
			if (err) return cb(err);

			for (let i = 0; result[i] !== undefined; i ++) {
				images[lUtils.formatUuid(result[i].uuid)]	= result[i];
				images[lUtils.formatUuid(result[i].uuid)].uuid	= lUtils.formatUuid(result[i].uuid);
				images[lUtils.formatUuid(result[i].uuid)].metadata	= [];
			}
			cb(err);
		});
	});

	// Get metadata
	tasks.push(function (cb) {
		if (! Object.keys(images).length) return cb();

		const dbFields = [];

		let	sql	= '';

		sql	+= 'SELECT * FROM images_images_metadata as metadata\n';
		sql += 'WHERE imageUuid IN (';
		for (const imageUuid of Object.keys(images)) {
			sql += '?,';
			dbFields.push(lUtils.uuidToBuffer(imageUuid));
		}
		sql = sql.substring(0, sql.length - 1) + ')';

		that.db.query(sql, dbFields, function (err, result) {
			for (let i = 0; result[i] !== undefined; i ++) {
				result[i].imageUuid	= lUtils.formatUuid(result[i].imageUuid);
				metadata.push(result[i]);
			}
			cb(err);
		});
	});

	async.series(tasks, function (err) {
		for (let i = 0; metadata[i] !== undefined; i ++) {
			const	imageUuid	= metadata[i].imageUuid;

			if (images[imageUuid] === undefined) {
				that.log.verbose(logPrefix + 'Image/metadata missmatch. Metadata with imageUuid "' + imageUuid + '" is not assosciated with any image');
				continue;
			}

			delete metadata[i].imageUuid;
			images[imageUuid].metadata.push(metadata[i]);
		}

		if (err) return cb(err, images);

		const dbFields = [];

		// Get total elements for pagination
		that.db.query('SELECT images.uuid, images.slug, COUNT(*) AS count FROM images_images AS images ' + generateWhere(dbFields), dbFields, function (err, result) {
			if (err) return cb(err, images);

			if (options.includeBinaryData) {
				const	subtasks	= [];

				for (let uuid in images) {
					subtasks.push(function (cb) {
						const	path	= that.getPathToImage(uuid);

						if (err) return cb(err);

						fs.readFile(path + uuid + '.' + images[uuid].type, function (err, image) {
							if (err) return cb(err);
							images[uuid].image	= image;
							cb();
						});
					});
				}

				async.parallel(subtasks, function (err) {
					cb(err, images, result[0].count);
				});
			} else {
				cb(err, images, result[0].count);
			}
		});
	});
};

Img.prototype.rmImage = function rmImage(uuid, cb) {
	const	logPrefix	= topLogPrefix + 'rmImage() - ',
		imgUuid	= lUtils.uuidToBuffer(uuid),
		tasks	= [],
		that	= this;

	let	slug,
		type;

	if ( ! imgUuid) {
		const	err	= new Error('Invalid uuid');
		that.log.warn(logPrefix + err.message);
		return cb(err);
	}

	tasks.push(function (cb) {
		that.dataWriter.ready(cb);
	});

	// Get slug
	tasks.push(function (cb) {
		that.db.query('SELECT * FROM images_images WHERE uuid = ?', imgUuid, function (err, rows) {
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
		const	options	= {'exchange': that.options.exchangeName},
			message	= {};

		message.action	= 'rmImage';
		message.params	= {};
		message.params.uuid	= uuid;

		that.dataWriter.intercom.send(message, options, function (err, msgUuid) {
			if (err) return cb(err);

			that.dataWriter.emitter.once(msgUuid, cb);
		});
	});

	if (that.options.mode !== 'slave') {
		// Delete actual file
		tasks.push(function (cb) {
			const	path	= that. getPathToImage(uuid),
				fullPath	= path + uuid + '.' + type;

			if (path === false) {
				const	err	= new Error('Could not get path to file with uuid "' + uuid + '"');
				that.log.warn(logPrefix + err.message);
				return cb(err);
			}

			fs.unlink(fullPath, function (err) {
				if (err) {
					that.log.warn(logPrefix + 'Could not unlink file: "' + fullPath + '", err: ' + err.message);
				}
				cb();
			});
		});

		tasks.push(function (cb) {
			if ( ! slug) return cb();

			that.clearCache({'slug': slug, 'uuid': uuid}, cb);
		});
	}

	async.series(tasks, cb);
};

/**
 * Save an image
 *
 * @param obj data -	{
 *		'uuid':	d8d2bed2-4da1-4650-968c-7acc81b62c92,
 *		'slug':	'barfoo'
 *		'file':	File obj from formidable, see https://github.com/felixge/node-formidable#formidablefile for more info
 *		'metadata': [
 *			{
 *				'name':	'deer',
 *				'data':	'tasty'
 *			},
 *			{
 *				'name':	'frog',
 *				'data':	'disgusting'
 *			}
 *		] - Optional
 *	}
 * @param func cb(err, image) - the image will be a row from getImages()
 */
Img.prototype.saveImage = function saveImage(data, cb) {
	const	logPrefix	= topLogPrefix + 'saveImage() - ',
		tasks	= [],
		that	= this;

	let	tmpFilePath,
		imgType;

	if ( ! data.file) {
		const	err	= new Error('Missing file object from formidable');
		that.log.warn(logPrefix + err.message);
		that.log.verbose(logPrefix + err.stack);
		return cb(err);
	}

	// If id is missing, we MUST have a file
	if (data.uuid === undefined && data.file === undefined) {
		that.log.info(logPrefix + 'Upload file is missing, but required since no uuid is supplied.');
		return cb(new Error('Image file is required'));
	}

	// If we have an image file, make sure the format is correct
	if (data.file !== undefined) {
		that.log.debug(logPrefix + 'data.file missing');

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

			if (imageType(data.file.bin) === null) {
				const	err	= new Error('Could not determine image type from data, can not save');
				that.log.warn(logPrefix + err.message);
				return cb(err);
			}

			tmpFilePath	= os.tmpdir() + '/' + uuidLib.v1() + '.' + imageType(data.file.bin).ext;

			tasks.push(function (cb) {
				fs.writeFile(tmpFilePath, data.file.bin, function (err) {
					if (err) {
						that.log.warn(logPrefix + 'Could not write to tmpFilePath: "' + tmpFilePath + '", err: ' + err.message);
					}
					cb(err);
				});
			});

		} else {
			const	err	= new Error('Neither binary data or file path was given, can not save');
			that.log.warn(logPrefix + err.message);
			return cb(err);
		}

		tasks.push(function (cb) {
			let	filePath;

			imgType	= imageType(data.file.bin);

			if (tmpFilePath) {
				filePath	= tmpFilePath;
			} else {
				filePath	= data.file.path;
			}

			// As a first step, check the mime type, since this is already given to us
			if ( ! imgType || (imageType(data.file.bin).mime !== 'image/png' && imageType(data.file.bin).mime !== 'image/jpeg' && imageType(data.file.bin).mime !== 'image/gif')) {
				that.log.info(logPrefix + 'Invalid mime type for uploaded file.');
				return cb(new Error('Invalid file format, must be of image type PNG, JPEG or GIF'));
			}

			// Resizing gifs not supported by jimp, convert to png instead
			if (imageType(data.file.bin).mime === 'image/gif') {
				that.log.info(logPrefix + 'GIFs not supported. Image will be converted to PNG');

				jimp.read(filePath, function (err, image) {
					tmpFilePath	= os.tmpdir() + '/' + uuidLib.v1() + '.png';

					if (err) {
						that.log.warn(logPrefix + 'Unable to open uploaded file: ' + err.message);
						return cb(err);
					}

					// Here you probably could call the cb directly to speed things up
					image.quality(80).write(tmpFilePath, function (err) {
						if (err) {
							that.log.warn(logPrefix + 'Failed to write file: ' + err.message);
							return cb(err);
						}

						// Set imageType from file just to be sure
						fs.readFile(tmpFilePath, function (err, bin) {
							data.file.bin	= bin;
							imgType	= imageType(bin);
							cb();
						});
					});
				});
			} else {
				// Then actually checks so the file loads in our image lib
				jimp.read(filePath, function (err) {
					if (err) {
						that.log.warn(logPrefix + 'Unable to open uploaded file: ' + err.message);
					}

					cb(err);
				});
			}
		});

		// Set image type
		tasks.push(function (cb) {
			data.file.type	= imgType.ext;
			cb();
		});
	}

	// Set the slug if needed
	tasks.push(function (cb) {
		const	dbFields	= [];

		let	sql;

		// If no slug or uuid was supplied use the filename as base for the slug
		if ( ! data.uuid && ! data.slug) {
			data.slug	= data.file.name;
		}

		// If no slug is set by here, it means an id is supplied and the slug
		// should not change in the database, no need to check anything more here
		if ( ! data.slug) {
			return cb();
		} else {
			data.slug	= slug(data.slug, {'save': ['/', '.', '_', '-']});
			data.slug	= _.trim(data.slug, '/');

			// If the image was a gif it has been changed to a png and the slug should reflect this
			if (data.slug.endsWith('.gif') && imgType.ext === 'png') {
				that.log.debug(logPrefix + 'Old slug: "' + data.slug + '"');
				data.slug = data.slug.substring(0, data.slug.length - 3) + 'png';
				that.log.debug(logPrefix + 'New slug: "' + data.slug + '"');
			}
		}

		// Make sure it is not occupied by another image
		sql	= 'SELECT uuid FROM images_images WHERE slug = ?';
		dbFields.push(data.slug);
		if (data.uuid !== undefined) {
			sql += ' AND uuid != ?';
			dbFields.push(lUtils.uuidToBuffer(data.uuid));
		}

		that.db.query(sql, dbFields, function (err, rows) {
			if (err) return cb(err);

			if (rows.length) {
				const	err	= new Error('Slug: "' + data.slug + '" is used by another image entry, try setting another one manually.');
				that.log.verbose(logPrefix + err.message);
				return cb(err);
			}

			cb();
		});
	});

	// Save database data through queue
	tasks.push(function (cb) {
		const	options	= {'exchange': that.options.exchangeName},
			message	= {};

		message.action	= 'saveImage';
		message.params	= {};

		if (data.uuid === undefined) {
			data.uuid	= uuidLib.v4();
		}

		message.params.data	= _.cloneDeep(data);
		delete message.params.data.file.bin; // this must be deleted or is otherwise sent over rabbit

		that.dataWriter.intercom.send(message, options, function (err, msgUuid) {
			if (err) return cb(err);

			that.dataWriter.emitter.once(msgUuid, cb);
		});
	});

	// Save file data
	if (data.file) {
		tasks.push(function (cb) {
			that.createImageDirectory(data.uuid, function (err, path) {
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
		that.db.query('SELECT slug FROM images_images WHERE uuid = ?', [lUtils.uuidToBuffer(data.uuid)], function (err, rows) {
			if (err) return cb(err);

			if (rows.length === 0) {
				const	err	= new Error('Could not find database row of newly saved image uuid: "' + data.uuid + '"');
				that.log.error(logPrefix + '' + err.message);
				return cb(err);
			}

			that.clearCache({'slug': rows[0].slug}, cb);
		});
	});

	// Remove temporary file
	tasks.push(function (cb) {
		if (tmpFilePath === undefined) return cb();

		fs.unlink(tmpFilePath, function (err) {
			if (err) {
				that.log.warn(logPrefix + 'Could not remove tmpFilePath "' + tmpFilePath + '", err: ' + err.message);
			}

			cb(err);
		});
	});

	async.series(tasks, function (err) {
		// Something went wrong. Clean up and callback the error
		if (err) return cb(err);

		// Re-read this entry from the database to be sure to get the right deal!
		that.getImages({'uuids': data.uuid}, function (err, images) {
			if (err) return cb(err);

			cb(null, images[Object.keys(images)[0]]);
		});
	});
};

exports = module.exports = Img;