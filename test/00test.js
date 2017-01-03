'use strict';

const	//assert	= require('assert'),
	async	= require('async'),
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

		let testImage;
//				imageId;

		// Load test image
		tasks.push(function(cb) {
			fs.readFile(__dirname + '/../testimage.jpg', function read(err, data) {
				if (err) throw err;
				testImage = data;
				cb();
			});
		});

		// Save test image
		tasks.push(function(cb) {
			let data = {
				'file': {
					'bin': testImage,
					'name': 'testimage.jpg'
				}
			};

			img.saveImage(data, function(err, imaeege) {
				if (err) throw err;
				console.log(imaeege);
				cb();
			});
		});


		// Get saved image
		async.series(tasks, function(err) {
			if (err) throw err;
			done();
		});


//		assert.deepEqual(toString.call(order),	'[object Object]');
//		assert.deepEqual(uuidValidate(order.uuid, 4),	true);
//		assert.deepEqual(toString.call(order.created),	'[object Date]');
//		assert.deepEqual(order.rows instanceof Array,	true);
//		assert.deepEqual(order.rows.length,	0);


	});

});


after(function(done) {
	db.removeAllTables(done);
});
