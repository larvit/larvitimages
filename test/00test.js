'use strict';

const	bufferEqual	= require('buffer-equal'),
	tmpFolder	= require('os').tmpdir() + '/larvitimages_test',
	uuidLib	= require('uuid'),
	rimraf	= require('rimraf'),
	mkdirp	= require('mkdirp'),
	lUtils	= require('larvitutils'),
	assert	= require('assert'),
	async	= require('async'),
	jimp	= require('jimp'),
	img	= require(__dirname + '/../img.js'),
	log	= require('winston'),
	db	= require('larvitdb'),
	os	= require('os'),
	fs	= require('fs-extra');

// Set up winston
log.remove(log.transports.Console);
/**/log.add(log.transports.Console, {
	'level':	'warn',
	'colorize':	true,
	'timestamp':	true,
	'json':	false
});/**/

before(function (done) {
	const	tasks	= [];

	this.timeout(10000);

	// Run DB Setup
	tasks.push(function (cb) {
		let confFile;

		if (process.env.DBCONFFILE === undefined) {
			confFile = __dirname + '/../config/db_test.json';
		} else {
			confFile = process.env.DBCONFFILE;
		}

		log.verbose('DB config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function (err) {
			if (err) {

				// Then look for this string in the config folder
				confFile = __dirname + '/../config/' + confFile;
				fs.stat(confFile, function (err) {
					if (err) throw err;
					log.verbose('DB config: ' + JSON.stringify(require(confFile)));
					db.setup(require(confFile), cb);
				});

				return;
			}

			log.verbose('DB config: ' + JSON.stringify(require(confFile)));
			db.setup(require(confFile), cb);
		});
	});

	// Check for empty db
	tasks.push(function (cb) {
		db.query('SHOW TABLES', function (err, rows) {
			if (err) throw err;

			if (rows.length) {
				throw new Error('Database is not empty. To make a test, you must supply an empty database!');
			}

			cb();
		});
	});

	// Create tmp folder
	tasks.push(function (cb) {
		mkdirp(tmpFolder, cb);
	});

	// Setting mode and intercom for test purposes
	// This is not required for the tests to pass, but it is required to not trigger warnings
	tasks.push(function (cb) {
		const	Intercom	= require('larvitamintercom');
		img.dataWriter.mode	= 'master';
		img.dataWriter.intercom	= new Intercom('loopback interface');
		cb();
	});

	tasks.push(img.dataWriter.ready);

	async.series(tasks, done);
});

describe('LarvitImages', function () {
	it('should save an image in database', function (done) {
		const	tasks	= [];

		let	saveObj	= { 'file': { 'name': 'testimage1.jpg' } };

		// Create testimage
		tasks.push(function (cb) {
			new jimp(256, 256, 0xFF0000FF, function (err, image) {
				if (err) throw err;

				image.getBuffer(jimp.MIME_JPEG, function (err, result) {
					if (err) throw err;
					saveObj.file.bin	= result;

					cb();
				});
			});
		});

		// Save test image
		tasks.push(function (cb) {
			img.saveImage(saveObj, function (err, image) {
				if (err) throw err;
				saveObj.uuid	= image.uuid;

				cb();
			});
		});

		// Get saved image
		tasks.push(function (cb) {
			const options = {
				'uuids':	[saveObj.uuid],
				'includeBinaryData':	true
			};
			img.getImages(options, function (err, images, totalElements) {
				if (err) throw err;
				let	image	= images[Object.keys(images)[0]];
				assert.strictEqual(totalElements, 1);
				assert(bufferEqual(image.image, saveObj.file.bin));
				assert.strictEqual(saveObj.file.name, image.slug);
				cb();
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;
			done();
		});
	});

	it('should save an image in database with metadata', function (done) {
		const	tasks	= [];

		let	saveObj	=
			{
				'file': {
					'name': 'testimage1_1.jpg'
				},
				'metadata': [
					{
						'name': 'deer',
						'data': 'tasty'
					},
					{
						'name': 'frog',
						'data': 'disgusting'
					}
				]
			};

		// Create testimage
		tasks.push(function (cb) {
			new jimp(256, 256, 0xFF0000FF, function (err, image) {
				if (err) throw err;

				image.getBuffer(jimp.MIME_JPEG, function (err, result) {
					if (err) throw err;
					saveObj.file.bin	= result;
					cb();
				});
			});
		});

		// Save test image
		tasks.push(function (cb) {
			img.saveImage(saveObj, function (err, image) {
				if (err) throw err;
				saveObj.uuid	= image.uuid;
				cb();
			});
		});

		// Get saved image
		tasks.push(function (cb) {
			const options = {
				'uuids':	[saveObj.uuid],
				'includeBinaryData':	true
			};
			img.getImages(options, function (err, images, totalElements) {
				if (err) throw err;
				let image = images[Object.keys(images)[0]];
				assert.strictEqual(totalElements, 1);
				assert(bufferEqual(image.image, saveObj.file.bin));
				assert.strictEqual(saveObj.file.name, image.slug);
				assert.deepEqual(saveObj.metadata[0], image.metadata[0]);
				assert.deepEqual(saveObj.metadata[1], image.metadata[1]);
				cb();
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;
			done();
		});
	});

	it('should remove image', function (done) {
		const	tasks	= [];

		let	saveObj	= { 'file': { 'name': 'testimage2.jpg' } };

		// Create testimage
		tasks.push(function (cb) {
			new jimp(256, 256, 0xFF0000FF, function (err, image) {
				if (err) throw err;

				image.getBuffer(jimp.MIME_JPEG, function (err, result) {
					if (err) throw err;
					saveObj.file.bin = result;
					cb();
				});
			});
		});

		// Save test image
		tasks.push(function (cb) {
			img.saveImage(saveObj, function (err, image) {
				if (err) throw err;
				saveObj.uuid = image.uuid;
				cb();
			});
		});

		// Remove image
		tasks.push(function (cb) {
			img.rmImage(saveObj.uuid, cb);
		});

		// Get saved image to see if it's gone
		tasks.push(function (cb) {
			const options = {
				'uuids':	[saveObj.uuid],
				'includeBinaryData':	true
			};
			img.getImages(options, function (err, images, totalElements) {
				if (err) throw err;
				assert.strictEqual(totalElements, 0);
				assert.strictEqual(Object.keys(images).length, 0);
				cb();
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;
			done();
		});

	});

	it('should get image by uuid', function (done) {
		const	tasks	= [];

		let	saveObj	= { 'file': { 'name': 'testimage3.jpg' } };

		// Create testimage
		tasks.push(function (cb) {
			new jimp(256, 256, 0xFF0000FF, function (err, image) {
				if (err) throw err;

				image.getBuffer(jimp.MIME_JPEG, function (err, result) {
					if (err) throw err;
					saveObj.file.bin = result;
					cb();
				});
			});
		});

		// Save test image
		tasks.push(function (cb) {
			img.saveImage(saveObj, function (err, image) {
				if (err) throw err;
				saveObj.uuid	= image.uuid;
				cb();
			});
		});

		// Get saved image
		tasks.push(function (cb) {
			const options = {
				'uuids':	[saveObj.uuid],
				'includeBinaryData':	true
			};
			img.getImages(options, function (err, images, totalElements) {
				let	image;

				if (err) throw err;

				image	= images[Object.keys(images)[0]];
				assert(bufferEqual(saveObj.file.bin, image.image));
				assert.strictEqual(saveObj.file.name, image.slug);
				assert.strictEqual(totalElements, 1);
				cb();
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;
			done();
		});
	});

	it('should get image by slug', function (done) {
		const	tasks	= [];

		let saveObj = { 'file': { 'name': 'testimage4.jpg' } };

		// Create testimage
		tasks.push(function (cb) {
			new jimp(256, 256, 0xFF0000FF, function (err, image) {
				if (err) throw err;

				image.getBuffer(jimp.MIME_JPEG, function (err, result) {
					if (err) throw err;
					saveObj.file.bin	= result;
					cb();
				});
			});
		});

		// Save test image
		tasks.push(function (cb) {
			img.saveImage(saveObj, function (err, image) {
				if (err) throw err;
				saveObj.uuid	= image.uuid;
				cb();
			});
		});

		// Get saved image
		tasks.push(function (cb) {
			const options = {
				'slugs':	[saveObj.file.name],
				'includeBinaryData':	true
			};
			img.getImages(options, function (err, images) {
				if (err) throw err;
				let	image	= images[Object.keys(images)[0]];
				assert(bufferEqual(image.image, saveObj.file.bin));
				assert.strictEqual(saveObj.file.name, image.slug);
				cb();
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;
			done();
		});
	});

	it('should get image by query', function (done) {
		const	tasks	= [];

		let saveObj = { 'file': { 'name': 'testimage55.jpg' }, 'metadata': [
			{
				'name': 'party',
				'data': 'fun'
			},
			{
				'name': 'work',
				'data': 'boring'
			}
		]};

		// Create testimage
		tasks.push(function (cb) {
			new jimp(256, 256, 0xFF0000FF, function (err, image) {
				if (err) throw err;

				image.getBuffer(jimp.MIME_JPEG, function (err, result) {
					if (err) throw err;
					saveObj.file.bin	= result;
					cb();
				});
			});
		});

		// Save test image
		tasks.push(function (cb) {
			img.saveImage(saveObj, function (err, image) {
				if (err) throw err;
				saveObj.uuid	= image.uuid;
				cb();
			});
		});

		// Get saved image
		tasks.push(function (cb) {
			const options = {
				'q':	'ring',
				'includeBinaryData':	true
			};
			img.getImages(options, function (err, images) {
				if (err) throw err;
				let	image	= images[Object.keys(images)[0]];
				assert(bufferEqual(image.image, saveObj.file.bin));
				assert.strictEqual(saveObj.file.name, image.slug);
				cb();
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;
			done();
		});
	});

	it('should get only binary by slug', function (done) {
		const	tasks	= [];

		let saveObj = { 'file': { 'name': 'testimage5.jpg' } };

		// Create testimage
		tasks.push(function (cb) {
			new jimp(256, 256, 0xFF0000FF, function (err, image) {
				if (err) throw err;

				image.getBuffer(jimp.MIME_JPEG, function (err, result) {
					if (err) throw err;
					saveObj.file.bin	= result;
					cb();
				});
			});
		});

		// Save test image
		tasks.push(function (cb) {
			img.saveImage(saveObj, function (err, image) {
				if (err) throw err;
				saveObj.uuid	= image.uuid;
				cb();
			});
		});

		// Get saved image
		tasks.push(function (cb) {
			const	options	= {'slug': saveObj.file.name};

			img.getImageBin(options, function (err, image) {
				if (err) throw err;
				assert(bufferEqual(image, saveObj.file.bin));
				cb();
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;
			done();
		});
	});

	it('should get only binary by slug with custom height', function (done) {
		const	tmpFileName	= os.tmpdir() + '/' + uuidLib.v1() + '.jpg',
			options	= {},
			tasks	= [];

		let	saveObj	= { 'file': { 'name': 'testimage6.jpg' } };

		// Create testimage
		tasks.push(function (cb) {
			new jimp(256, 256, 0xFF0000FF, function (err, image) {
				if (err) throw err;

				image.getBuffer(jimp.MIME_JPEG, function (err, result) {
					if (err) throw err;
					saveObj.file.bin	= result;
					cb();
				});
			});
		});

		// Save test image
		tasks.push(function (cb) {
			img.saveImage(saveObj, function (err, image) {
				if (err) throw err;
				saveObj.uuid	= image.uuid;
				cb();
			});
		});

		// Get saved image bin
		tasks.push(function (cb) {
			options.slug	= saveObj.file.name;
			options.height	= 500;

			img.getImageBin(options, function (err, image) {
				if (err) throw err;

				fs.writeFile(tmpFileName, image, function (err) {
					if (err) throw err;
					cb(err);
				});
			});
		});

		// Open tmp file and check
		tasks.push(function (cb) {
			jimp.read(tmpFileName, function (err, image) {
				if (err) throw err;

				assert.strictEqual(options.height, image.bitmap.height);
				assert.strictEqual(options.height, image.bitmap.width);
				cb(err);
			});
		});

		// Delete tmp file
		tasks.push(function (cb) {
			fs.unlink(tmpFileName, function (err) {
				if (err) throw err;
				cb(err);
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;
			done();
		});
	});

	it('should get only binary by slug with custom width', function (done) {
		const	tmpFileName	= os.tmpdir() + '/' + uuidLib.v1() + '.jpg',
			options	= {},
			tasks	= [];

		let	saveObj	= { 'file': { 'name': 'testimage7.jpg' } };

		// Create testimage
		tasks.push(function (cb) {
			new jimp(256, 256, 0xFF0000FF, function (err, image) {
				if (err) throw err;

				image.getBuffer(jimp.MIME_JPEG, function (err, result) {
					if (err) throw err;
					saveObj.file.bin	= result;
					cb();
				});
			});
		});

		// Save test image
		tasks.push(function (cb) {
			img.saveImage(saveObj, function (err, image) {
				if (err) throw err;
				saveObj.uuid	= image.uuid;
				cb();
			});
		});

		// Get saved image binary and write to tmp file
		tasks.push(function (cb) {
			options.slug	= saveObj.file.name;
			options.width	= 500;

			img.getImageBin(options, function (err, image) {
				if (err) throw err;

				fs.writeFile(tmpFileName, image, function (err) {
					if (err) throw err;
					cb(err);
				});
			});
		});

		// Open tmp file and check
		tasks.push(function (cb) {
			jimp.read(tmpFileName, function (err, image) {
				if (err) throw err;

				assert.strictEqual(options.width, image.bitmap.height);
				assert.strictEqual(options.width, image.bitmap.width);
				cb(err);
			});
		});

		// Delete tmp file
		tasks.push(function (cb) {
			fs.unlink(tmpFileName, function (err) {
				if (err) throw err;
				cb(err);
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;
			done();
		});
	});

	it('should get only binary by slug with custom height and width', function (done) {
		const	tmpFileName	= os.tmpdir() + '/' + uuidLib.v1() + '.jpg',
			options	= {},
			tasks	= [];

		let	saveObj	= { 'file': { 'name': 'testimage8.jpg' } };

		// Create testimage
		tasks.push(function (cb) {
			new jimp(256, 256, 0xFF0000FF, function (err, image) {
				if (err) throw err;

				image.getBuffer(jimp.MIME_JPEG, function (err, result) {
					if (err) throw err;
					saveObj.file.bin	= result;
					cb();
				});
			});
		});

		// Save test image
		tasks.push(function (cb) {
			img.saveImage(saveObj, function (err, image) {
				if (err) throw err;
				saveObj.uuid	= image.uuid;
				cb();
			});
		});

		// Get saved image binary and write to tmp file
		tasks.push(function (cb) {
			options.slug	= saveObj.file.name;
			options.width	= 500;
			options.height	= 750;

			img.getImageBin(options, function (err, image) {
				if (err) throw err;

				fs.writeFile(tmpFileName, image, function (err) {
					if (err) throw err;
					cb(err);
				});
			});
		});

		// Open tmp file and check
		tasks.push(function (cb) {
			jimp.read(tmpFileName, function (err, image) {
				if (err) throw err;

				assert.strictEqual(options.width, image.bitmap.width);
				assert.strictEqual(options.height, image.bitmap.height);
				cb(err);
			});
		});

		// Delete tmp file
		tasks.push(function (cb) {
			fs.unlink(tmpFileName, function (err) {
				if (err) throw err;
				cb(err);
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;
			done();
		});
	});

	it('should clear cached image based on slug', function (done) {
		const	tmpFileName	= os.tmpdir() + '/' + uuidLib.v1() + '.jpg',
			options	= {},
			tasks	= [];

		let	saveObj	= { 'file': { 'name': 'testimage9.jpg' } };

		// Create testimage
		tasks.push(function (cb) {
			new jimp(256, 256, 0xFF0000FF, function (err, image) {
				if (err) throw err;

				image.getBuffer(jimp.MIME_JPEG, function (err, result) {
					if (err) throw err;
					saveObj.file.bin	= result;
					cb();
				});
			});
		});

		// Save test image
		tasks.push(function (cb) {
			img.saveImage(saveObj, function (err, image) {
				if (err) throw err;
				saveObj.uuid	= image.uuid;
				cb();
			});
		});

		// Get saved image
		tasks.push(function (cb) {
			options.slug	= saveObj.file.name;
			options.width	= 400;
			options.height	= 400;

			img.getImageBin(options, function (err, image) {
				if (err) throw err;

				fs.writeFile(tmpFileName, image, function (err) {
					if (err) throw err;
					cb(err);
				});
			});
		});

		// Open tmp file and check
		tasks.push(function (cb) {
			jimp.read(tmpFileName, function (err, image) {
				if (err) throw err;

				assert.strictEqual(options.width, image.bitmap.width);
				assert.strictEqual(options.height, image.bitmap.height);
				cb(err);
			});
		});

		// Clear created image cached
		tasks.push(function (cb) {
			const	options = { 'slug': saveObj.file.name };

			img.clearCache(options, function (err) {
				if (err) throw err;
				cb();
			});
		});

		// Check if cached image is deleted
		tasks.push(function (cb) {
			const	uuid	= lUtils.formatUuid(saveObj.uuid),
				path	= img.cacheDir + '/' + uuid.substr(0, 4).split('').join('/') + '/' + uuid + '_w400_h400.jpg';

			fs.stat(path, function (err) {
				assert(err);
				cb();
			});
		});

		async.series(tasks, function (err) {
			if (err) throw err;
			done();
		});
	});

	it('Should convert gifs to png when saved', function (done) {
		const tasks	= [],
			saveObj	= {
				'file':	{ 'path': __dirname + '/flanders.gif' },
				'slug':	'flanders.gif'
			};

		let uuid = null;

		// Save test image
		tasks.push(function (cb) {
			img.saveImage(saveObj, function (err, image) {
				if (err) throw err;

				assert.strictEqual(image.type, 'png');
				assert.notStrictEqual(image.uuid, undefined);
				assert.strictEqual(image.slug, 'flanders.png');

				uuid	= image.uuid;
				cb();
			});
		});

		// Get image data
		tasks.push(function (cb) {
			const options = {
				'uuid'	: uuid,
				'width'	: 400,
				'height'	: 400
			};

			img.getImageBin(options, function (err, data) {
				assert.notStrictEqual(data, undefined);
				cb(err);
			});
		});

		async.series(tasks, done);
	});
});

after(function (done) {
	const	tasks	= [];

	tasks.push(function (cb) {
		db.removeAllTables(cb);
	});

	tasks.push(function (cb) {
		rimraf(tmpFolder, cb);
	});

	tasks.push(function (cb) {
		rimraf(__dirname + '/../larvitimages', cb);
	});

	async.parallel(tasks, done);
});
