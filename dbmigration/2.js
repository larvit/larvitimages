'use strict';

const	lUtils	= require('larvitutils'),
	imgLib	= require(__dirname + '/../img.js'),
	async	= require('async');

exports = module.exports = function (cb) {
	const	tasks	= [],
		db	= this.options.dbDriver;

	let uuids;

	// add etag column
	tasks.push(function (cb) {
		const sql = 'ALTER TABLE images_images ADD etag VARCHAR(32)';
		db.query(sql, function (err) {
			if (err) throw err;
			cb();
		});
	});

	// fetch image uuids
	tasks.push(function (cb) {
		db.query('SELECT uuid FROM images_images', function (err, result) {
			uuids = result;
			cb(err);
		});
	});

	// generate etags for all images
	tasks.push(function (cb) {
		const tasks = [];

		if (uuids.length === 0) return cb();

		for (const uuid of uuids) {
			tasks.push(function (cb) {
				imgLib.generateEtag(imgLib.getPathToImage(lUtils.formatUuid(uuid), false), function (err, tag) {
					db.query('UPDATE images_images SET etag = ? WHERE uuid = ?', [tag, uuid], cb);
				});
			});
		}

		async.parallelLimit(tasks, 10, cb);
	});

	async.series(tasks, function (err) {
		if (err) throw err;
		cb();
	});
};
