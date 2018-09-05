'use strict';

exports.run = function (req, res, cb) {
	const	data	= {'global': res.globalData},
		options	= {};

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		cb(new Error('Invalid rights'), req, res, {});
		return;
	}

	data.pagination	= {};
	data.pagination.elementsPerPage	= 100;
	data.pagination.urlParsed = data.global.urlParsed;

	options.limit = data.pagination.elementsPerPage;
	options.offset = parseInt(data.global.urlParsed.query.offset) || 0;
	options.q = data.global.urlParsed.query.q;

	if (options.offset < 0) {
		options.offset = 0;
	}

	req.imgLib.getImages(options, function (err, rows, totalElements) {
		if (err) return cb(err);
		
		data.images = rows;
		data.pagination.totalElements = totalElements;
		cb(null, req, res, data);
	});
};
