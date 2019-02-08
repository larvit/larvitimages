'use strict';

module.exports = function run(req, res, cb) {
	const	options	= {};

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		cb(new Error('Invalid rights'), req, res, {});
		return;
	}

	res.data	= {'global': res.globalData};
	res.data.pagination	= {};
	res.data.pagination.elementsPerPage	= 100;
	res.data.pagination.urlParsed = res.data.global.urlParsed;

	options.limit = res.data.pagination.elementsPerPage;
	options.offset = parseInt(res.data.global.urlParsed.query.offset) || 0;
	options.q = res.data.global.urlParsed.query.q;

	if (options.offset < 0) {
		options.offset = 0;
	}

	req.imgLib.getImages(options, function (err, rows, totalElements) {
		if (err) return cb(err);
		
		res.data.images = rows;
		res.data.pagination.totalElements = totalElements;
		cb(null, req, res);
	});
};
