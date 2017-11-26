'use strict';

const	uuidLib	= require('uuid'),
	async	= require('async');

exports = module.exports = function (cb) {
	const	tasks	= [],
		db	= this.options.dbDriver;

	let rows;

	// add etag column
	tasks.push(function (cb) {
		const sql = 'ALTER TABLE images_images ADD etag BINARY(16)';
		db.query(sql, function (err) {
			if (err) throw err;
			cb();
		});
	});

	// fetch image uuids
	tasks.push(function (cb) {
		db.query('SELECT uuid, type FROM images_images', function (err, result) {
			rows = result;
			cb(err);
		});
	});

	// generate etags for all images
	tasks.push(function (cb) {
		const tasks = [];

		if (rows.length === 0) return cb();

		for (const row of rows) {
			tasks.push(function (cb) {
				db.query('UPDATE images_images SET etag = ? WHERE uuid = ?', [uuidLib.v4(), row.uuid], cb);
			});
		}

		async.parallelLimit(tasks, 10, cb);
	});

	async.series(tasks, function (err) {
		if (err) throw err;
		cb();
	});
};
