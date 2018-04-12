'use strict';

const	topLogPrefix	= 'larvitimages: dataWriter.js: ',
	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	DbMigration	= require('larvitdbmigration'),
	Intercom	= require('larvitamintercom'),
	checkKey	= require('check-object-key'),
	lUtils	= require('larvitutils'),
	amsync	= require('larvitamsync'),
	async	= require('async'),
	that	= this,
	log	= require('winston'),
	db	= require('larvitdb');

let	readyInProgress	= false,
	isReady	= false;

function listenToQueue(retries, cb) {
	const	logPrefix	= topLogPrefix + 'listenToQueue() - ',
		options	= {'exchange': exports.exchangeName},
		tasks	= [];

	let	listenMethod;

	if (typeof retries === 'function') {
		cb	= retries;
		retries	= 0;
	}

	if (typeof cb !== 'function') {
		cb = function (){};
	}

	if (retries === undefined) {
		retries = 0;
	}

	tasks.push(function (cb) {
		checkKey({
			'obj':	exports,
			'objectKey':	'intercom',
			'default':	new Intercom('loopback interface'),
			'defaultLabel':	'loopback interface'
		}, function (err, warning) {
			if (warning) log.warn(logPrefix + warning);
			cb(err);
		});
	});

	tasks.push(function (cb) {
		checkKey({
			'obj':	exports,
			'objectKey':	'mode',
			'default':	'noSync',
			'validValues':	['master', 'slave', 'noSync']
		}, function (err, warning) {
			if (warning) log.warn(logPrefix + warning);
			cb(err);
		});
	});

	// Set listenMethod
	tasks.push(function (cb) {
		// Make sure this is ran next tick so mode can be set
		setImmediate(function () {
			if (exports.mode === 'master') {
				listenMethod	= 'consume';
				options.exclusive	= true;	// It is important no other client tries to sneak
				//		out messages from us, and we want "consume"
				//		since we want the queue to persist even if this
				//		minion goes offline.
			} else if (exports.mode === 'slave' || exports.mode === 'noSync') {
				listenMethod = 'subscribe';
			} else {
				const	err	= new Error('Invalid exports.mode. Must be either "master", "slave" or "noSync", but is: "' + exports.mode + '"');
				log.error(logPrefix + err.message);
				return cb(err);
			}

			log.info(logPrefix + 'listenMethod: ' + listenMethod);
			cb();
		});
	});

	// Wait for intercom ready
	tasks.push(function (cb) {
		exports.intercom.ready(cb);
	});

	// Listen to intercom
	tasks.push(function (cb) {
		exports.intercom[listenMethod](options, function (message, ack, deliveryTag) {
			exports.ready(function (err) {
				ack(err); // Ack first, if something goes wrong we log it and handle it manually

				if (err) {
					log.error(logPrefix + 'intercom.' + listenMethod + '() - exports.ready() returned err: ' + err.message);
					return;
				}

				if (typeof message !== 'object') {
					log.error(logPrefix + 'intercom.' + listenMethod + '() - Invalid message received, is not an object! deliveryTag: "' + deliveryTag + '"');
					return;
				}

				if (typeof exports[message.action] === 'function') {
					exports[message.action](message.params, deliveryTag, message.uuid);
				} else {
					log.warn(logPrefix + 'intercom.' + listenMethod + '() - Unknown message.action received: "' + message.action + '"');
				}
			});
		}, cb);
	});

	// Run ready function
	tasks.push(ready);

	async.series(tasks);
}
// Run listenToQueue as soon as all I/O is done, this makes sure the exports.mode can be set
// by the application before listening commences
setImmediate(listenToQueue);

// This is ran before each incoming message on the queue is handeled
function ready(retries, cb) {
	const	logPrefix	= topLogPrefix + 'ready() - ',
		tasks	= [];

	if (typeof retries === 'function') {
		cb	= retries;
		retries	= 0;
	}

	if (typeof cb !== 'function') {
		cb = function (){};
	}

	if (retries === undefined) {
		retries	= 0;
	}

	if (isReady === true) return cb();

	if (readyInProgress === true) {
		eventEmitter.on('ready', cb);
		return;
	}

	readyInProgress = true;

	tasks.push(function (cb) {
		checkKey({
			'obj':	exports,
			'objectKey':	'intercom',
			'default':	new Intercom('loopback interface'),
			'defaultLabel':	'loopback interface'
		}, function (err, warning) {
			if (warning) log.warn(logPrefix + warning);
			cb(err);
		});
	});

	tasks.push(function (cb) {
		checkKey({
			'obj':	exports,
			'objectKey':	'mode',
			'default':	'noSync',
			'validValues':	['master', 'slave', 'noSync']
		}, function (err, warning) {
			if (warning) log.warn(logPrefix + warning);
			cb(err);
		});
	});

	tasks.push(function (cb) {
		setImmediate(function () {
			if (exports.mode === 'slave') {
				log.verbose(logPrefix + 'exports.mode: "' + exports.mode + '", so read');
				amsync.mariadb({
					'exchange':	exports.exchangeName + '_dataDump',
					'intercom':	exports.intercom
				}, cb);
			} else if (exports.mode === 'noSync') {
				log.info(logPrefix + 'exports.mode: "' + exports.mode + '", will not sync with others before starting');
				cb();
			} else if (exports.mode === 'master') {
				log.verbose(logPrefix + 'exports.mode: "' + exports.mode + '"');
				cb();
			} else {
				const	err	= new Error('Invalid exports.mode! Must be "master", "slave" or "noSync", but is: "' + exports.mode + '"');
				log.error(logPrefix + err.message);
				return cb(err);
			}
		});
	});

	// Migrate database
	tasks.push(function (cb) {
		const	options	= {};

		let	dbMigration;

		options.dbType	= 'larvitdb';
		options.dbDriver	= db;
		options.tableName	= 'images_db_version';
		options.migrationScriptsPath	= __dirname + '/dbmigration';
		dbMigration	= new DbMigration(options);

		dbMigration.run(function (err) {
			if (err) {
				log.error(logPrefix + 'Database error: ' + err.message);
			}

			cb(err);
		});
	});

	async.series(tasks, function (err) {
		if (err) return;

		isReady	= true;
		eventEmitter.emit('ready');

		if (exports.mode === 'master') {
			runDumpServer(cb);
		} else {
			cb();
		}
	});
}

function rmImage(params, deliveryTag, msgUuid) {
	const	logPrefix	= topLogPrefix + 'rmImage() - ',
		tasks	= [],
		uuid	= lUtils.uuidToBuffer(params.uuid);

	tasks.push(function (cb) {
		if ( ! uuid ) {
			const	err	= new Error('Invalid uuid supplied');
			log.error(logPrefix + err.message);
			return cb(err);
		}
		cb();
	});

	tasks.push(ready);

	// Delete metadata
	tasks.push(function (cb) {
		db.query('DELETE FROM images_images_metadata WHERE imageUuid = ?;', uuid, cb);
	});

	// Delete database entry
	tasks.push(function (cb) {
		db.query('DELETE FROM images_images WHERE uuid = ?', uuid, cb);
	});

	async.series(tasks, function (err) {
		exports.emitter.emit(msgUuid, err);
	});
}

function runDumpServer(cb) {
	const	options	= {
			'exchange': exports.exchangeName + '_dataDump',
			'host': that.options.amsync ? that.options.amsync.host : null,
			'minPort': that.options.amsync ? that.options.amsync.minPort : null,
			'maxPort': that.options.amsync ? that.options.amsync.maxPort : null
		},
		args	= [];

	if (db.conf.host) {
		args.push('-h');
		args.push(db.conf.host);
	}

	args.push('-u');
	args.push(db.conf.user);

	if (db.conf.password) {
		args.push('-p' + db.conf.password);
	}

	args.push('--single-transaction');
	args.push('--hex-blob');
	args.push(db.conf.database);

	// Tables
	args.push('images_images');
	args.push('images_db_version');
	args.push('images_images_metadata');

	options.dataDumpCmd = {
		'command':	'mysqldump',
		'args':	args
	};

	options['Content-Type']	= 'application/sql';
	options.intercom	= exports.intercom;

	new amsync.SyncServer(options, cb);
}

function saveImage(params, deliveryTag, msgUuid) {
	const	logPrefix	= topLogPrefix + 'saveImage() - ',
		tasks	= [],
		uuid	= lUtils.uuidToBuffer(params.data.uuid);

	tasks.push(function (cb) {
		if ( ! uuid ) {
			const	err	= new Error('Invalid uuid supplied');
			log.error(logPrefix + err.message);
			return cb(err);
		}
		cb();
	});

	// Set image record
	tasks.push(function (cb) {
		const	sql	= 'INSERT IGNORE INTO images_images (uuid, slug) VALUES(?,?);',
			dbFields	= [uuid, params.data.slug];

		db.query(sql, dbFields, function (err) {
			if (err) return cb(err);
			log.debug(logPrefix + 'New image created with uuid: "' + params.data.uuid + '"');
			cb();
		});
	});

	// Check if a record was created with our slug and uuid
	// In case the slug was already taken this have not happened and we need to return an error
	tasks.push(function (cb) {
		db.query('SELECT slug FROM images_images WHERE uuid = ?', uuid, function (err, rows) {
			if (err) return cb(err);

			if (rows.length === 0) {
				const	err	= new Error('Slug was already taken (or other unknown error)');
				log.info(logPrefix + err.message);
				return cb(err);
			}
			cb(); // All is well, move on
		});
	});

	// Set slug (We do this in case it changed on an already existing entry)
	tasks.push(function (cb) {
		const	sql	= 'UPDATE images_images SET slug = ? WHERE uuid = ?;',
			dbFields	= [params.data.slug, uuid];

		db.query(sql, dbFields, cb);
	});

	// Set type if it exists
	if (params.data.file && params.data.file.type) {
		tasks.push(function (cb) {
			const	sql	= 'UPDATE images_images SET type = ? WHERE uuid = ?;',
				dbFields	= [params.data.file.type, uuid];

			db.query(sql, dbFields, cb);
		});
	}

	// Save metadata
	// First delete all existing metadata about this image
	tasks.push(function (cb) {
		db.query('DELETE FROM images_images_metadata WHERE imageUuid = ?;', uuid, cb);
	});

	// Insert new metadata
	if (params.data.metadata !== undefined && Array.isArray(params.data.metadata) && params.data.metadata.length !== 0) {
		tasks.push(function (cb) {
			const	dbFields	= [];

			let	sql	= 'INSERT INTO images_images_metadata (imageUuid, name, data) VALUES ';

			for (let i = 0; params.data.metadata[i] !== undefined; i ++) {
				sql += '(?,?,?),';
				dbFields.push(uuid);
				dbFields.push(params.data.metadata[i].name);
				dbFields.push(params.data.metadata[i].data);
			}

			sql = sql.substring(0, sql.length - 1) + ';';
			db.query(sql, dbFields, cb);
		});
	}

	async.series(tasks, function (err) {
		exports.emitter.emit(msgUuid, err);
	});
}

exports.emitter	= new EventEmitter();
exports.exchangeName	= 'larvitimages';
exports.options	= undefined;
exports.ready	= ready;
exports.rmImage	= rmImage;
exports.saveImage	= saveImage;
