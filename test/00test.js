'use strict';

const	bufferEqual	= require('buffer-equal'),
	assert	= require('assert'),
	async	= require('async'),
	lwip	= require('lwip'),
	log	= require('winston'),
	db	= require('larvitdb'),
	fs	= require('fs');

let	img;

// Set up winston
log.remove(log.transports.Console);
/** /log.add(log.transports.Console, {
	'level':	'debug',
	'colorize':	true,
	'timestamp':	true,
	'json':	false
});/**/

before(function(done) {
	const	tasks	= [];
	// Run DB Setup
	tasks.push(function(cb) {
		let confFile;

		if (process.env.DBCONFFILE === undefined) {
			confFile = __dirname + '/../config/db_test.json';
		} else {
			confFile = process.env.DBCONFFILE;
		}

		log.verbose('DB config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function(err) {
			if (err) {

				// Then look for this string in the config folder
				confFile = __dirname + '/../config/' + confFile;
				fs.stat(confFile, function(err) {
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
	tasks.push(function(cb) {
		db.query('SHOW TABLES', function(err, rows) {
			if (err) throw err;

			if (rows.length) {
				throw new Error('Database is not empty. To make a test, you must supply an empty database!');
			}

			cb();
		});
	});

	tasks.push(function(cb) {
		img	= require(__dirname + '/../img.js');
		cb();
	});

	async.series(tasks, done);
});

describe('Images', function() {

	it('should save an image in database', function(done) {
		const	tasks	= [];

		let saveObj = {
					'file': {
						'name': 'testimage.jpg'
					}
				};

		// Create testimage
		tasks.push(function(cb) {
			lwip.create(1000, 1000, 'red', function(err, image){
				if (err) throw err;
				image.toBuffer('jpg', {'quality': 100}, function(err, image) {
					saveObj.file.bin = image;
					cb();
				});
			});
		});

		// Save test image
		tasks.push(function(cb) {
			img.saveImage(saveObj, function(err, image) {
				if (err) throw err;
				saveObj.uuid = image.uuid;
				cb();
			});
		});

		// Get saved image
		tasks.push(function(cb) {
			const options = {
				'uuids': [saveObj.uuid],
				'includeBinaryData':	true
			};
			img.getImages(options, function(err, image) {
				if (err) throw err;
				assert(bufferEqual(image[0].image, saveObj.file.bin));
				assert.deepEqual(saveObj.file.name, image[0].slug);
				cb();
			});
		});

		async.series(tasks, function(err) {
			if (err) throw err;
			done();
		});
	});
});

after(function(done) {
	db.removeAllTables(done);
});
