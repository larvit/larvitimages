'use strict';

const	topLogPrefix	= 'larvitimages: dataWriter.js: ',
	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	DbMigration	= require('larvitdbmigration'),
	Intercom	= require('larvitamintercom'),
	lUtils	= require('larvitutils'),
	amsync	= require('larvitamsync'),
	async	= require('async'),
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

	tasks.push(checkIntercom);
	tasks.push(checkMode);

	// Set listenMethod
	tasks.push(function (cb) {
		// Make sure this is ran next tick so mode can be set
		setImmediate(function () {
			if (exports.mode === 'master') {
				listenMethod	= 'consume';
				options.exclusive	= true;	// It is important no other client tries to sneak
						// out messages from us, and we want "consume"
						// since we want the queue to persist even if this
						// minion goes offline.
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

	async.series(tasks);
}
// Run listenToQueue as soon as all I/O is done, this makes sure the exports.mode can be set
// by the application before listening commences
setImmediate(listenToQueue);

function checkIntercom(firstRun, cb) {
	const	logPrefix	= topLogPrefix + 'checkIntercom() - ';

	if (typeof firstRun === 'function') {
		cb	= firstRun;
		firstRun	= true;
	} else if (firstRun === undefined) {
		firstRun	= true;
		cb	= function () {};
	}

	if (exports.intercom instanceof Intercom) {
		log.debug(logPrefix + 'exports.intercom is set, no modification needed');
	} else if (lUtils.instances.intercom instanceof Intercom) {
		log.info(logPrefix + 'Using larvitutils.instances.intercom as Intercom');
		exports.intercom	= lUtils.instances.intercom;
	} else if (firstRun === false) {
		log.warn(logPrefix + 'Neither exports.intercom nor larvitutils.instances.intercom is an instance of Intercom. Fallback to create our own loopback interface.');
		exports.intercom	= new Intercom('loopback interface');
	} else {
		// Give the app 50ms to sort this shit out before we use the fallback fallback
		setTimeout(function () {
			checkIntercom(false, cb);
		}, 50);
		return;
	}

	cb();
}

function checkMode(firstRun, cb) {
	const	logPrefix	= topLogPrefix + 'checkMode() - ';

	if (typeof firstRun === 'function') {
		cb	= firstRun;
		firstRun	= true;
	} else if (firstRun === undefined) {
		firstRun	= true;
		cb	= function () {};
	}

	if (exports.mode === 'slave' || exports.mode === 'master' || exports.mode === 'noSync') {
		log.debug(logPrefix + 'exports.mode is set, no modification needed');
	} else if (lUtils.instances.dataWriterMode !== undefined) {
		log.info(logPrefix + 'Using larvitutils.instances.dataWriterMode as mode');
		exports.mode	= lUtils.instances.dataWriterMode;
	} else if (firstRun === false) {
		log.warn(logPrefix + 'Neither exports.mode nor larvitutils.instances.dataWriterMode is set to a valid string. Falling back to noSync.');
		exports.mode	= 'noSync';
	} else {
		// Give the app 50ms to sort this shit out before we use the fallback fallback
		setTimeout(function () {
			checkMode(false, cb);
		}, 50);
		return;
	}

	cb();
}

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

	tasks.push(checkIntercom);
	tasks.push(checkMode);

	tasks.push(function (cb) {
		setImmediate(function () {
			if (exports.mode === 'slave') {
				log.verbose(logPrefix + 'exports.mode: "' + exports.mode + '", so read');
				amsync.mariadb({'exchange': exports.exchangeName + '_dataDump'}, cb);
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
	const	tasks	= [];

	tasks.push(ready);

	// Delete metadata
	tasks.push(function (cb) {
		db.query('DELETE FROM images_images_metadata WHERE imageUuid = ?;', [lUtils.uuidToBuffer(params.uuid)], cb);
	});

	// Delete database entry
	tasks.push(function (cb) {
		db.query('DELETE FROM images_images WHERE uuid = ?', [lUtils.uuidToBuffer(params.uuid)], cb);
	});

	async.series(tasks, function (err) {
		exports.emitter.emit(msgUuid, err);
	});
}

function runDumpServer(cb) {
	const	options	= {'exchange': exports.exchangeName + '_dataDump'},
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

	options['Content-Type'] = 'application/sql';

	new amsync.SyncServer(options, cb);
}

function saveImage(params, deliveryTag, msgUuid) {
	const	logPrefix	= topLogPrefix + 'saveImage() - ',
		tasks	= [];

	// Set image record
	tasks.push(function (cb) {
		const	sql	= 'INSERT IGNORE INTO images_images (uuid, slug) VALUES(?,?);',
			dbFields	= [lUtils.uuidToBuffer(params.data.uuid), params.data.slug];

		db.query(sql, dbFields, function (err) {
			if (err) return cb(err);
			log.debug(logPrefix + 'New image created with uuid: "' + params.data.uuid + '"');
			cb();
		});
	});

	// Set slug (We do this in case it changed on an already existing entry)
	tasks.push(function (cb) {
		const	sql	= 'UPDATE images_images SET slug = ? WHERE uuid = ?;',
			dbFields	= [params.data.slug, lUtils.uuidToBuffer(params.data.uuid)];

		db.query(sql, dbFields, cb);
	});

	// Set type if it exists
	if (params.data.file && params.data.file.type) {
		tasks.push(function (cb) {
			const	sql	= 'UPDATE images_images SET type = ? WHERE uuid = ?;',
				dbFields	= [params.data.file.type, lUtils.uuidToBuffer(params.data.uuid)];

			db.query(sql, dbFields, cb);
		});
	}

	// Save metadata
	// First delete all existing metadata about this image
	tasks.push(function (cb) {
		db.query('DELETE FROM images_images_metadata WHERE imageUuid = ?;', [lUtils.uuidToBuffer(params.data.uuid)], cb);
	});

	// Insert new metadata
	if (params.data.metadata !== undefined && Array.isArray(params.data.metadata) && params.data.metadata.length !== 0) {
		tasks.push(function (cb) {
			const	dbFields	= [];

			let	sql	= 'INSERT INTO images_images_metadata (imageUuid, name, data) VALUES ';

			for (let i = 0; params.data.metadata[i] !== undefined; i ++) {
				sql += '(?,?,?),';
				dbFields.push(lUtils.uuidToBuffer(params.data.uuid));
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
exports.ready	= ready;
exports.rmImage	= rmImage;
exports.saveImage	= saveImage;
