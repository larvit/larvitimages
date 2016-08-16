'use strict';

const	images	= require('larvitimages');

exports.run = function(req, res, cb) {
	const	data	= {'global': res.globalData};

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		cb(new Error('Invalid rights'), req, res, {});
		return;
	}

	images.getImages({'limit': false}, function(err, rows) {
		data.images = rows;
		cb(null, req, res, data);
	});
};
