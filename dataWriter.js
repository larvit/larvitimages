'use strict';

const	topLogPrefix	= 'larvitimages: dataWriter.js: ',
	EventEmitter	= require('events').EventEmitter,
	DbMigration	= require('larvitdbmigration'),
	lUtils	= new (require('larvitutils'))(),
	amsync	= require('larvitamsync'),
	async	= require('async');

function DataWriter(options, cb) {
	const	that	= this;

	for (const key of Object.keys(options)) {
		that[key]	= options[key];
	}

	that.emitter	= new EventEmitter();
	that.isReady	= false;
	that.readyInProgress = false;

	that.listenToQueue(cb);
}

DataWriter.prototype.listenToQueue = function listenToQueue(cb) {
	const	logPrefix	= topLogPrefix + 'listenToQueue() - ',
		options	= {'exchange': this.exchangeName},
		tasks	= [],
		that	= this;

	let	listenMethod;

	if ( ! cb) cb = function () {};

	// Set listenMethod
	tasks.push(function (cb) {
		if (that.mode === 'master') {
			listenMethod	= 'consume';
			options.exclusive	= true;	// It is important no other client tries to sneak
			//		out messages from us, and we want "consume"
			//		since we want the queue to persist even if this
			//		minion goes offline.
		} else if (that.mode === 'slave' || that.mode === 'noSync') {
			listenMethod	= 'subscribe';
		}

		that.log.info(logPrefix + 'listenMethod: ' + listenMethod);
		cb();
	});

	// Wait for intercom to be ready
	tasks.push(function (cb) {
		that.intercom.ready(cb);
	});

	// Listen to intercom
	tasks.push(function (cb) {
		that.intercom[listenMethod](options, function (message, ack, deliveryTag) {
			that.ready(function (err) {
				ack(err); // Ack first, if something goes wrong we log it and handle it manually

				if (err) {
					that.log.error(logPrefix + 'intercom.' + listenMethod + '() - exports.ready() returned err: ' + err.message);
					return;
				}

				if (typeof message !== 'object') {
					that.log.error(logPrefix + 'intercom.' + listenMethod + '() - Invalid message received, is not an object! deliveryTag: "' + deliveryTag + '"');
					return;
				}

				if (typeof that[message.action] === 'function') {
					that[message.action](message.params, deliveryTag, message.uuid);
				} else {
					that.log.warn(logPrefix + 'intercom.' + listenMethod + '() - Unknown message.action received: "' + message.action + '"');
				}
			});
		}, cb);
	});

	tasks.push(function (cb) {
		that.ready(cb);
	});

	async.series(tasks, function (err) {
		if (err) that.log.error(logPrefix + err.message);
		cb(err);
	});
};

// This is ran before each incoming message on the queue is handeled
DataWriter.prototype.ready = function ready(cb) {
	const	logPrefix	= topLogPrefix + 'ready() - ',
		tasks	= [],
		that	= this;

	if (typeof cb !== 'function') {
		cb	= function () {};
	}

	if (that.isReady === true) return cb();

	if (that.readyInProgress === true) {
		that.emitter.on('ready', cb);
		return;
	}

	that.readyInProgress	= true;

	tasks.push(function (cb) {
		if (that.mode === 'slave') {
			that.log.verbose(logPrefix + 'mode: "' + that.mode + '", so read');
			new amsync.SyncClient({
				'intercom': that.intercom,
				'exchange': that.exchangeName + '_dataDump'
			}, cb);
		} else if (that.mode === 'noSync') {
			that.log.info(logPrefix + 'mode: "' + that.mode + '", will not sync with others before starting');
			cb();
		} else if (that.mode === 'master') {
			that.log.verbose(logPrefix + 'mode: "' + that.mode + '"');
			cb();
		}
	});

	// Migrate database
	tasks.push(function (cb) {
		const	options	= {};

		let	dbMigration;

		options.dbType	= 'mariadb';
		options.dbDriver	= that.db;
		options.tableName	= 'images_db_version';
		options.migrationScriptsPath	= __dirname + '/dbmigration';
		options.log	= that.log;
		dbMigration	= new DbMigration(options);

		dbMigration.run(function (err) {
			if (err) {
				that.log.error(logPrefix + 'Database error: ' + err.message);
			}
			cb(err);
		});
	});

	async.series(tasks, function (err) {
		if (err) return cb(err);

		that.isReady	= true;
		that.emitter.emit('ready');

		if (that.mode === 'master') {
			that.runDumpServer(cb);
		} else {
			cb();
		}
	});
};

DataWriter.prototype.rmImage = function rmImage(params, deliveryTag, msgUuid) {
	const	logPrefix	= topLogPrefix + 'rmImage() - ',
		tasks	= [],
		that	= this,
		uuid	= lUtils.uuidToBuffer(params.uuid);

	tasks.push(function (cb) {
		if ( ! uuid ) {
			const	err	= new Error('Invalid uuid supplied');
			that.log.error(logPrefix + err.message);
			return cb(err);
		}
		cb();
	});

	tasks.push(function (cb) {
		that.ready(cb);
	});

	// Delete metadata
	tasks.push(function (cb) {
		that.db.query('DELETE FROM images_images_metadata WHERE imageUuid = ?;', uuid, cb);
	});

	// Delete database entry
	tasks.push(function (cb) {
		that.db.query('DELETE FROM images_images WHERE uuid = ?', uuid, cb);
	});

	async.series(tasks, function (err) {
		that.emitter.emit(msgUuid, err);
	});
};

DataWriter.prototype.runDumpServer = function runDumpServer(cb) {
	const that	= this,
		options = {
			'exchange':	that.exchangeName + '_dataDump',
			'host':	that.amsync_host,
			'minPort':	that.amsync_minPort,
			'maxPort':	that.amsync_maxPort
		},
		args	= [];

	if (that.db.conf.host) {
		args.push('-h');
		args.push(that.db.conf.host);
	}

	args.push('-u');
	args.push(that.db.conf.user);

	if (that.db.conf.password) {
		args.push('-p' + that.db.conf.password);
	}

	args.push('--single-transaction');
	args.push('--hex-blob');
	args.push(that.db.conf.database);

	// Tables
	args.push('images_images');
	args.push('images_db_version');
	args.push('images_images_metadata');

	options.dataDumpCmd = {
		'command':	'mysqldump',
		'args':	args
	};

	options['Content-Type']	= 'application/sql';
	options.intercom	= that.intercom;

	new amsync.SyncServer(options, cb);
};

DataWriter.prototype.saveImage = function saveImage(params, deliveryTag, msgUuid) {
	const	logPrefix	= topLogPrefix + 'saveImage() - ',
		tasks	= [],
		that	= this,
		uuid	= lUtils.uuidToBuffer(params.data.uuid);

	tasks.push(function (cb) {
		if ( ! uuid ) {
			const	err	= new Error('Invalid uuid supplied');
			that.log.error(logPrefix + err.message);
			return cb(err);
		}
		cb();
	});

	// Set image record
	tasks.push(function (cb) {
		const	sql	= 'INSERT IGNORE INTO images_images (uuid, slug) VALUES(?,?);',
			dbFields	= [uuid, params.data.slug];

		that.db.query(sql, dbFields, function (err) {
			if (err) return cb(err);
			that.log.debug(logPrefix + 'New image created with uuid: "' + params.data.uuid + '"');
			cb();
		});
	});

	// Check if a record was created with our slug and uuid
	// In case the slug was already taken this have not happened and we need to return an error
	tasks.push(function (cb) {
		that.db.query('SELECT slug FROM images_images WHERE uuid = ?', uuid, function (err, rows) {
			if (err) return cb(err);

			if (rows.length === 0) {
				const	err	= new Error('Slug was already taken (or other unknown error)');
				that.log.info(logPrefix + err.message);
				return cb(err);
			}
			cb(); // All is well, move on
		});
	});

	// Set slug (We do this in case it changed on an already existing entry)
	tasks.push(function (cb) {
		const	sql	= 'UPDATE images_images SET slug = ? WHERE uuid = ?;',
			dbFields	= [params.data.slug, uuid];

		that.db.query(sql, dbFields, cb);
	});

	// Set type if it exists
	if (params.data.file && params.data.file.type) {
		tasks.push(function (cb) {
			const	sql	= 'UPDATE images_images SET type = ? WHERE uuid = ?;',
				dbFields	= [params.data.file.type, uuid];

			that.db.query(sql, dbFields, cb);
		});
	}

	// Save metadata
	// First delete all existing metadata about this image
	tasks.push(function (cb) {
		that.db.query('DELETE FROM images_images_metadata WHERE imageUuid = ?;', uuid, cb);
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
			that.db.query(sql, dbFields, cb);
		});
	}

	async.series(tasks, function (err) {
		that.emitter.emit(msgUuid, err);
	});
};

exports = module.exports = DataWriter;
