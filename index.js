'use strict';

const topLogPrefix = 'larvitimages: index.js: ';
const DataWriter = require(__dirname + '/dataWriter.js');
const imageType = require('image-type');
const Intercom = require('larvitamintercom');
const uuidLib = require('uuid');
const mkdirp = require('mkdirp');
const LUtils = require('larvitutils');
const lUtils = new LUtils();
const async = require('async');
const slug = require('larvitslugify');
const path = require('path');
const jimp = require('jimp');
const os = require('os');
const fs = require('fs-extra');
const _ = require('lodash');

/**
 * A Promise wrapped call to mkdirp
 * @param {string} path - Path to create
 * @returns {Promise} - A promise that resolves when directories are created
 */
function _mkdirp(path) {
	return new Promise((resolve, reject) => {
		mkdirp(path, function (err) {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
}

/**
 * A promise wrapper for fs.remove
 * @param {*} path - Path of item to remove
 * @returns {Promise} - Returns a promise that resolves when stuff is removed
 */
function _fsRemove(path) {
	return new Promise((resolve, reject) => {
		fs.remove(path, function (err) {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
}

/**
 * Promise wrapper for fs.exists
 * @param {string} path - Path to item to check
 * @returns {Promise} - A promise that resolves to a boolean telling the exists status of the item
 */
function _fsExists(path) {
	return new Promise((resolve, reject) => {
		fs.exists(path, (err, exists) => {
			if (err) {
				reject(err);
			} else {
				resolve(exists);
			}
		});
	});
}

/**
 * Promise wrapper for fs.readdir
 * @param {string} path - Path to dir to read 
 * @returns {Promise} - Promise that resolves array of string with contents of dir
 */
function _fsReadDir(path) {
	return new Promise((resolve, reject) => {
		fs.readdir(path, (err, files) => {
			if (err) {
				reject(err);
			} else {
				resolve(files);
			}
		});
	});
}

/**
 * Promise wrapper for fs.readFile
 * @param {string} path - Path to file to read 
 * @returns {Promise} - Promise that resolves a Buffer with conetents of file
 */
function _fsReadFile(path) {
	return new Promise((resolve, reject) => {
		fs.readFile(path, (err, data) => {
			if (err) {
				reject(err);
			} else {
				resolve(data);
			}
		});
	});
}

/**
 * A promise wrapper for running a database query, will resolve to the rows fetched
 * @param {object} db - The db instance to run the query on
 * @param {string} sql - The query to run
 * @param {object[]} dbFields - Parameters for the query
 */
async function _runQuery(db, sql, dbFields) {
	return new Promise((resolve, reject) => {
		db.query(sql, dbFields, (err, rows) => {
			if (err) {
				reject(err);
			} else {
				resolve(rows);
			}
		});
	});
};

/**
 * A promise wrapper for the ready function of the datawriter
 * @param {object} datawriter - A datawriter instance
 * @returns {Promise} - A promise that is resolved when the datawriter is ready
 */
async function _ready(datawriter) {
	return new Promise((resolve, reject) => {
		datawriter.ready(err => {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
}

/**
 * Generates a where-clause based on supplied options
 * @param {object} [options={}] - filter options
 * @param {string} [options.q] - Search query
 * @param {string[]} [options.slugs] - Limit by slugs
 * @param {string[]} [options.uuids] - Limit by uuids
 * @param {object} lUtils - larvitutils instance
 * @returns {object} - Object containing sql query and db fields
 */
function _generateWhere(options, lUtils) {
	const dbFields = [];
	let sql = '';

	sql += 'WHERE 1 + 1\n';

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

		sql += ' AND (images.slug IN (';

		for (let i = 0; options.slugs[i] !== undefined; i++) {
			sql += '?,';
			dbFields.push(options.slugs[i]);
		}

		// Select by slug without file ending
		sql = sql.substring(0, sql.length - 1) + ') OR SUBSTRING(images.slug, 1, CHAR_LENGTH(images.slug) - 1 - CHAR_LENGTH(SUBSTRING_INDEX(images.slug, \'.\', -1))) IN (';

		for (let i = 0; options.slugs[i] !== undefined; i++) {
			sql += '?,';
			dbFields.push(options.slugs[i]);
		}

		sql = sql.substring(0, sql.length - 1) + '))\n';
	}

	// Only get posts with given ids
	if (options.uuids !== undefined) {
		sql += ' AND images.uuid IN (';
		for (let i = 0; options.uuids[i] !== undefined; i++) {
			if (Buffer.isBuffer(options.uuids[i])) {
				sql += '?,';
				dbFields.push(options.uuids[i]);
			} else {
				const uuid = lUtils.uuidToBuffer(options.uuids[i]);

				if (!uuid) throw new Error('Bad uuid: "' + options.uuids[i] + '"');

				sql += '?,';
				dbFields.push(uuid);
			}
		}

		sql = sql.substring(0, sql.length - 1) + ')\n';
	}

	return { sql, dbFields };
}

/**
 * 
 * @param {object} db - Db instance 
 * @param {object} log - Logging instance
 * @param {object} lUtils - larvitutils instance
 * @param {object} dataWriter - Datawriter instance
 * @param {object} [options={}] - Options used to find the images wanted
 * @param {string[]} [options.uuids] - An array of image uuids to filter from
 * @param {string[]} [options.slugs] - An array of image slugs to filter from
 * @param {string} [options.q] - Search query
 * @param {Number} [options.limit=100] - Limits number of results
 * @param {Number} [options.offset] - Offset result by this amount
 * @returns {Promise} - A promise that resolves to an object containg an array of image objects and a number indicating the total amount of objects (for pagination)
 */
async function _get(db, log, lUtils, dataWriter, options) {
	const logPrefix = topLogPrefix + '_get() - ';

	if (!options) options = {};

	if (options.limit && isNaN(Number(options.limit))) throw new Error('Invalid limit: ' + options.limit);
	if (options.offset && isNaN(Number(options.offset))) throw new Error('Invalid offset: ' + options.offset);

	await _ready(dataWriter);

	const dbFields = [];
	let sql = 'SELECT images.uuid, images.slug, images.type FROM images_images as images\n';

	// Join on metadata
	// va fan gör den här?
	if (options.metadata && Object.keys(options.metadata).length) {
		if (Object.keys(options.metadata).length > 60) {
			const err = new Error('Can not select on more than a total of 60 metadata key value pairs due to database limitation in joins');

			that.log.warn(logPrefix + err.message);

			throw err;
		}

		let counter = 0;

		for (const name of Object.keys(options.metadata)) {
			const value = options.metadata[name];


			const uniqueMetadataName = 'metadata' + (++counter);

			sql += 'JOIN images_images_metadata as ' + uniqueMetadataName;
			sql += ' ON images.uuid = ' + uniqueMetadataName + '.imageUuid';
			sql += ' AND ' + uniqueMetadataName + '.name = ?';
			sql += ' AND ' + uniqueMetadataName + '.data = ?';
			sql += '\n';

			dbFields.push(name);
			dbFields.push(value);
		}
	}

	const whereResult = _generateWhere(options);

	sql += whereResult.sql;
	sql += 'ORDER BY images.slug\n';
	dbFields.concat(whereResult.dbFields);

	sql += 'LIMIT ' + options.limit === undefined ? 100 : options.limit + '\n';

	if (options.offset !== undefined) {
		sql += ' OFFSET ' + options.offset;
	}

	const images = [];
	const result = await _runQuery(db, sql, dbFields);

	for (let i = 0; result[i] !== undefined; i++) {
		images.push({
			uuid: lUtils.formatUuid(result[i].uuid),
			slug: result[i].slug,
			type: result[i].type,
			metadata: {}
		});
	}

	const metadataDbFields = images.map(i => lUtils.uuidToBuffer(i.uuid));
	let metadataSql = 'SELECT * FROM images_images_metadata WHERE imageUuid IN (';

	for (let i = 0; i < metadataDbFields.length; i++) {
		sql += '?,';
	}

	sql = sql.substr(0, sql.length - 1);
	sql += ')';

	const metadataRows = await _runQuery(metadataSql, metadataDbFields);

	for (let i = 0; i < metadataRows.length; i++) {
		const imageUuid = lUtils.formatUuid(metadataRows[i].imageUuid);
		const image = images.find(i => i.uuid === imageUuid);

		if (!image.metadata[metadataRows[i].name]) image.metadata[metadataRows[i].name] = [];
		image.metadata[metadataRows[i].name].push(metadataRows[i].value);
	}

	return {
		images,
		totalElements: await _runQuery(db, 'SELECT COUNT(*) AS count ' + whereResult.sql, whereResult.dbFields)[0].count
	};
}

// eslint-disable-next-line padded-blocks
class Images {

	/**
	 * Options for Files instance.
	 * @param {object} options - Files options
	 * @param {object} options.db - A mysql2 compatible db instance
	 * @param {string} [options.storagePath=process.cwd() + '/larvitimages'] - Path to where image files should be stored
	 * @param {string} [options.cacheDir=os.tmpdir() + '/larvitimages_cache'] - Path where cache of scaled images will be placed
	 * @param {object} [options.lUtils] - Instance of larvitutils. Will be created if not set
	 * @param {object} [options.log] - Instans of logger. Will default to larvitutils logger if not set
	 * @param {string} [options.exchangeName=larvitfiles] - Name of exchange used when communicating over Rabbitmq.
	 * @param {string} [options.prefix=/dbfiles/] - Prefix used to navigate to controller serving files
	 * @param {string} [options.mode=noSync] - Listening mode of dataWriter. Can be noSync, master, slave
	 * @param {Intercom} [options.intercom] - An instance of larvitamintercom. Will default to instance using "loopback interface"
	 * @param {string} [options.amsync_host=null] - Hostname used when syncing data
	 * @param {string} [options.amsync_minPort=null] - Min. port in range used when syncing data
	 * @param {string} [options.amsync_maxPort=null] - Max. port in range used when syncing data  
	 */
	constructor(options) {
		const logPrefix = topLogPrefix + '() - ';

		if (!options.db) {
			throw new Error('Required option db is missing');
		}

		if (!options.log) {
			options.log = new lUtils.Log();
		}

		if (!options.cacheDir) {
			options.cacheDir = os.tmpdir() + '/larvitimages_cache';
		}

		if (!options.storagePath) {
			options.storagePath = process.cwd() + '/larvitimages';
		}

		if (!options.exchangeName) {
			options.exchangeName = 'larvitimages';
		}

		if (!options.mode) {
			options.log.info(logPrefix + 'No "mode" option given, defaulting to "noSync"');
			options.mode = 'noSync';
		} else if (['noSync', 'master', 'slave'].indexOf(options.mode) === -1) {
			const err = new Error('Invalid "mode" option given: "' + options.mode + '"');

			options.log.error(logPrefix + err.message);
			throw err;
		}

		if (!options.intercom) {
			optionslog.info(logPrefix + 'No "intercom" option given, defaulting to "loopback interface"');
			options.intercom = new Intercom('loopback interface');
		}

		for (const key of Object.keys(options)) {
			this[key] = options[key];
		}

		this.dataWriter = new DataWriter({
			exchangeName: options.exchangeName,
			intercom: options.intercom,
			mode: options.mode,
			log: options.log,
			db: options.db,
			amsync_host: options.amsync_host || null,
			amsync_minPort: options.amsync_minPort || null,
			amsync_maxPort: options.amsync_maxPort || null
		});
	}

	/**
	 * Returns the path to an image with the specified uuid.
	 * @param {string} uuid - uuid of file to get path to
	 * @param {boolean} [cache] - look in cache
	 * @returns {string} - path to file
	 */
	getPathToImage(uuid, cache) {
		if (!uuid || typeof uuid !== 'string') throw new Error('Invalid uuid');

		if (cache) {
			return this.cacheDir + '/' + uuid.substr(0, 4).split('')
				.join('/') + '/';
		} else {
			return this.storagePath + '/' + uuid.substr(0, 4).split('')
				.join('/') + '/';
		}
	}

	/**
	 * Creates a directory for an image if it does not allready exist
	 * @param {string} uuid - Uuid of image
	 * @param {bool} [cache] - Use cache directory
	 * @returns {Promise} - Returns a promise that resolves when the directory is crated if it does not exist
	 */
	async createImageDirectory(uuid, cache) {
		const logPrefix = topLogPrefix + 'createImageDirectory() - ';
		let path = '';

		if (String(uuid).match(/^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$/) === null) {
			const err = new Error('Invalid uuid');

			that.log.warn(logPrefix + err.message);
			throw err;
		}

		path = that.getPathToImage(uuid, cache);

		if (!await _fsExists(path)) {
			try {
				await _mkdirp(path, this.log);
				this.log.debug(logPrefix + 'Successfully created path "' + path + '"');
			} catch (err) {
				this.log.error(logPrefix + 'Failed to create path "' + path + '", reason: ' + err.message);
				throw err;
			}
		}
	}

	/**
	 * Removed one (identified by slug or uuid) or all files in image cache
	 * @param {object} [options={}] - object with options
	 * @param {object} [options.uuid] - uuid of cached image to delete
	 * @param {string} [options.slug] - slug of cached image to delete
	 * @param {object} [options.clearAll=true] - Clears all files in cache, default to true if options not set
	 * @returns {Promise} - A promise that resolves when done
	 */
	async clearCache(options) {
		const logPrefix = topLogPrefix + 'clearCache() - ';

		if (!options) options = {clearAll: true};

		if (options.clearAll) {
			if (!await _fsExists(this.cacheDir)) return;
			await _fsRemove(this.cacheDir);

			return;
		}

		if (!options.slug && !options.uuid) throw new Error('Slug or uuid of file must be provided');

		if (options.slug) {
			// If no uuid is given get image data by slug.
			const image = await this.getImages({slugs: [options.slug]});

			if (Object.keys(image).length === 0) {
				this.log.warn(logPrefix + 'No image found in database with slug: ' + options.slug);

				return;
			} else {
				options.uuid = lUtils.formatUuid(image[Object.keys(image)[0]].uuid);
			}
		}

		// Check if the folder exists at all
		const folderPath = await this.getPathToImage(options.uuid, true);

		if (!await _fsExists(folderPath)) return;

		const files = await _fsReadDir(folderPath);
		const tasks = [];

		for (let i = 0; files[i] !== undefined; i++) {
			const fileName = files[i];

			if (fileName.substring(0, options.uuid.length) === options.uuid) {
				tasks.push(new Promise((resolve, reject) => {
					fs.unlink(path.join(folderPath, fileName), err => {
						if (err) {
							this.log.warn(logPrefix + 'Could not remove file: "' + fileName + '", err: ' + err.message);
							reject(err);
						} else {
							resolve();
						}
					});
				}));
			}
		}

		await Promise.all(tasks);
	}

	/**
	 * Will return the a buffer with image data of the desired dimensions
	 * @param {object} options - Options stuff
	 * @param {string} options.slug - Slug of image to get binary data of
	 * @param {Number} options.width - Desired width of image
	 * @param {Number} options.height - Desired height of image
	 * @returns {Promise} - A promise that resolves to a Buffer with containing binary data of image, or null if image is not found
	 */
	async getImageBin(options) {
		const logPrefix = topLogPrefix + 'getImageBin() - ';

		const images = await this.getImages({slugs: [options.slug]});

		if (images.length !== 0) {
			this.log.verbose(logPrefix + 'Could not find image with slug "' + options.slug + '"');

			return null;
		}

		const orgPath = this.getPathToImage(images[0].uuid, false) + images[0].uuid + '.' + images[0].type;
		let cachedPath = this.getPathToImage(images[0].uuid, true) + images[0].uuid;

		// Custom widht/height, look for cached file
		if (options.width || options.height) {
			if (options.width) cachedPath += '_w' + options.width;
			if (options.height) cachedPath += '_h' + options.height;
			cachedPath += ('.' + images[0].type);

			if (await _fsExists(cachedPath)) return _fsReadFile(cachedPath);

			// Custom resolution file does not exists,  create in cache
			const path = await this.createImage(images[0].uuid, options.width, options.height);

			return _fsReadFile(path);
		} else {
			// Original width/height, return as is
			return _fsReadFile(orgPath);
		}
	}

	/**
	 * Creates a new image of the desired dimension in the cache directory
	 * @param {string} uuid - Uuid of original image
	 * @param {*} [width] - New image width
	 * @param {*} [height] - New image height
	 * @returns {Promise} - A promise that is resolves to the path of the newly written image
	 */
	async createImage(uuid, width, height) {
		return new Promise((resolve, reject) => {
			const logPrefix = topLogPrefix + '_createFile() - ';
			const tasks = [];

			let image;
			let newImageName = uuid;

			if (!width && !height) return reject(new Error('Width or height must be set'));
			if (isNaN(Number(width)) || isNaN(Number(height))) return reject(new Error('Width and/or height must be numbers!'));

			// Read file data
			tasks.push(cb => {  // måste man ha filtyp här?
				jimp.read(path.join(this.getPathToImage(uuid), uuid), (err, img) => {
					image = img;
					cb(err);
				});
			});

			// Determine new image size
			tasks.push(cb => {
				const imgRatio = image.bitmap.width / image.bitmap.height;

				if (width && !height) {
					height = Math.round(width / imgRatio);
				} else if (height && !width) {
					width = Math.round(height * imgRatio);
				}

				newImageName += 'w_' + width;
				newImageName += 'h_' + height;
				newImageName += '.' + image.type;

				cb();
			});

			// Resize image
			tasks.push(cb => {
				image.resize(width, height, (err, img) => {
					if (err) {
						this.log.warn(logPrefix + 'Failed to resize image: ' + err.message);

						return cb(err);
					}

					image = img;
					cb();
				});
			});

			// Reduce image quality
			tasks.push(cb => {
				image.quality(90, (err, img) => {
					if (err) {
						this.log.warn(logPrefix + 'Failed to set image quality to 90: ' + err.message);

						return cb(err);
					}

					image = img;
					cb();
				});
			});

			// Create directory if needed
			tasks.push(cb => {
				if (fs.existsSync(this.getPathToImage(uuid, true))) return cb(); // Directory exits, do nothing

				mkdirp(this.getPathToImage(uuid, true), err => {
					if (err) {
						log.warn(logPrefix + 'Failed to create directory "' + this.getPathToImage(uuid) + '": ' + err.message);
					}

					cb(err);
				});
			});

			// Write new file to disk
			tasks.push(cb => {
				image.write(path.join(this.getPathToImage(uuid), newImageName), function (err) {
					if (err) {
						this.log.warn(logPrefix + 'Could not save image, err: ' + err.message);
					}

					cb(err);
				});
			});

			async.series(tasks, err => {
				if (err) {
					reject(err);
				} else {
					resolve(path.join(this.getPathToImage(uuid), newImageName));
				}
			});
		});
	}

	/**
	 * Returns an image by uuid, otherwise null
	 * @param {string} uuid - Uuid to identify image
	 * @returns {Promise} - A promise that resolves to an image object 
	 */
	async getByUuid(uuid) {
		const result = await _get(this.db, this.log, this.lUtils, this.dataWriter, {uuids: [uuid]});

		return result.images[0] || null;
	}

	/**
	 * Returns an image by slug, otherwise null
	 * @param {string} slug - Slug to identify image
	 * @returns {Promise} - A promise that resolves to an image object 
	 */
	async getBySlug(slug) {
		const rows = await _runQuery(db, 'SELECT uuid FROM images_images WHERE slug = ?', [slug]);

		if (rows.length !== 1) return null;

		return _get(this.db, this.log, this.lUtils, this.dataWriter, {uuids: [this.lUtils.formatUuid(rows[0].uuid)]}).images[0];
	}

	/**
	 * Fetches a list of image object and the total image count for the query
	 * @param {*} options - asdfad
	 * @returns {Promise} - A promise that resolves to an object with a list of image objects and the total image count for the query
	 */
	async list(options) {
		return _get(this.db, this.log, this.lUtils, this.dataWriter, options);
	}
}

Img.prototype.rmImage = function rmImage(uuid, cb) {
	const	logPrefix = topLogPrefix + 'rmImage() - ';


	const imgUuid = lUtils.uuidToBuffer(uuid);


	const tasks = [];


	const that = this;

	let	slug;


	let type;

	if (!imgUuid) {
		const	err = new Error('Invalid uuid');

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
				slug = rows[0].slug;
				type = rows[0].type;
			}

			cb();
		});
	});

	// Delete data through queue
	tasks.push(function (cb) {
		const	options = {exchange: that.options.exchangeName};


		const message = {};

		message.action = 'rmImage';
		message.params = {};
		message.params.uuid = uuid;

		that.dataWriter.intercom.send(message, options, function (err, msgUuid) {
			if (err) return cb(err);

			that.dataWriter.emitter.once(msgUuid, cb);
		});
	});

	if (that.options.mode !== 'slave') {
		// Delete actual file
		tasks.push(function (cb) {
			const	path = that.getPathToImage(uuid);


			const fullPath = path + uuid + '.' + type;

			if (path === false) {
				const	err = new Error('Could not get path to file with uuid "' + uuid + '"');

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
			if (!slug) return cb();

			that.clearCache({slug: slug, uuid: uuid}, cb);
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
	const	logPrefix = topLogPrefix + 'saveImage() - ';


	const tasks = [];


	const that = this;

	let	tmpFilePath;


	let imgType;

	if (!data.file) {
		const	err = new Error('Missing file object from formidable');

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

		if (!data.file.bin && data.file.path) {
			// Read binary data if it is not read already

			tasks.push(function (cb) {
				fs.readFile(data.file.path, function (err, result) {
					data.file.bin = result;
					cb(err);
				});
			});
		} else if (data.file.bin && !data.file.path) {
			// Save bin data to temp file if no path was provided

			if (imageType(data.file.bin) === null) {
				const	err = new Error('Could not determine image type from data, can not save');

				that.log.warn(logPrefix + err.message);

				return cb(err);
			}

			tmpFilePath = os.tmpdir() + '/' + uuidLib.v1() + '.' + imageType(data.file.bin).ext;

			tasks.push(function (cb) {
				fs.writeFile(tmpFilePath, data.file.bin, function (err) {
					if (err) {
						that.log.warn(logPrefix + 'Could not write to tmpFilePath: "' + tmpFilePath + '", err: ' + err.message);
					}
					cb(err);
				});
			});
		} else {
			const	err = new Error('Neither binary data or file path was given, can not save');

			that.log.warn(logPrefix + err.message);

			return cb(err);
		}

		tasks.push(function (cb) {
			let	filePath;

			imgType = imageType(data.file.bin);

			if (tmpFilePath) {
				filePath = tmpFilePath;
			} else {
				filePath = data.file.path;
			}

			// As a first step, check the mime type, since this is already given to us
			if (!imgType || (imageType(data.file.bin).mime !== 'image/png' && imageType(data.file.bin).mime !== 'image/jpeg' && imageType(data.file.bin).mime !== 'image/gif')) {
				that.log.info(logPrefix + 'Invalid mime type for uploaded file.');

				return cb(new Error('Invalid file format, must be of image type PNG, JPEG or GIF'));
			}

			// Resizing gifs not supported by jimp, convert to png instead
			if (imageType(data.file.bin).mime === 'image/gif') {
				that.log.info(logPrefix + 'GIFs not supported. Image will be converted to PNG');

				jimp.read(filePath, function (err, image) {
					tmpFilePath = os.tmpdir() + '/' + uuidLib.v1() + '.png';

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
							data.file.bin = bin;
							imgType = imageType(bin);
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
			data.file.type = imgType.ext;
			cb();
		});
	}

	// Set the slug if needed
	tasks.push(function (cb) {
		const	dbFields = [];

		let	sql;

		// If no slug or uuid was supplied use the filename as base for the slug
		if (!data.uuid && !data.slug) {
			data.slug = data.file.name;
		}

		// If no slug is set by here, it means an id is supplied and the slug
		// should not change in the database, no need to check anything more here
		if (!data.slug) {
			return cb();
		} else {
			data.slug = slug(data.slug, {save: ['/', '.', '_', '-']});
			data.slug = _.trim(data.slug, '/');

			// If the image was a gif it has been changed to a png and the slug should reflect this
			if (data.slug.endsWith('.gif') && imgType.ext === 'png') {
				that.log.debug(logPrefix + 'Old slug: "' + data.slug + '"');
				data.slug = data.slug.substring(0, data.slug.length - 3) + 'png';
				that.log.debug(logPrefix + 'New slug: "' + data.slug + '"');
			}
		}

		// Make sure it is not occupied by another image
		sql = 'SELECT uuid FROM images_images WHERE slug = ?';
		dbFields.push(data.slug);
		if (data.uuid !== undefined) {
			sql += ' AND uuid != ?';
			dbFields.push(lUtils.uuidToBuffer(data.uuid));
		}

		that.db.query(sql, dbFields, function (err, rows) {
			if (err) return cb(err);

			if (rows.length) {
				const	err = new Error('Slug: "' + data.slug + '" is used by another image entry, try setting another one manually.');

				that.log.verbose(logPrefix + err.message);

				return cb(err);
			}

			cb();
		});
	});

	// Save database data through queue
	tasks.push(function (cb) {
		const	options = {exchange: that.options.exchangeName};


		const message = {};

		message.action = 'saveImage';
		message.params = {};

		if (data.uuid === undefined) {
			data.uuid = uuidLib.v4();
		}

		message.params.data = _.cloneDeep(data);
		delete message.params.data.file.bin; // This must be deleted or is otherwise sent over rabbit

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
				const	err = new Error('Could not find database row of newly saved image uuid: "' + data.uuid + '"');

				that.log.error(logPrefix + '' + err.message);

				return cb(err);
			}

			that.clearCache({slug: rows[0].slug}, cb);
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
		that.getImages({uuids: data.uuid}, function (err, images) {
			if (err) return cb(err);

			cb(null, images[Object.keys(images)[0]]);
		});
	});
};

exports = module.exports = Images;
