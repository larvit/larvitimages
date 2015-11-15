'use strict';

var images = require('larvitimages');

exports.run = function(req, res, callback) {
	var data = {'global': res.globalData};

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		callback(new Error('Invalid rights'), req, res, {});
		return;
	}

	images.getImages({'limit': false}, function(err, rows) {
		data.images = rows;
		callback(null, req, res, data);
	});
};