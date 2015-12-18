'use strict';

var mime = require('mime-types'),
    log  = require('winston'),
    img  = require('larvitimages'),
    url  = require('url'),
    _    = require('lodash');

exports.run = function(req, res) {
	var request = url.parse(req.url, true),
	    slug    = _.trim(request.pathname.substring(17), '/'), // /uploaded/images/
	    imgMime;

	img.getImageBin({'slug': slug, 'width': request.query.width, 'height': request.query.height}, function(err, imgBuf) {
		if (err) {
			log.info('larvitimages: controllers/serveDbImages.js - err from img.getImageBin(): ' + err.message);
			res.writeHead(500, {'Content-Type': 'text/plain' });
			res.end('Something is funky with this image, the server got sad. :(');
			return;
		}

		if ( ! imgBuf) {
			res.writeHead(404, {'Content-Type': 'text/plain' });
			res.end('File not found');
			return;
		}

		imgMime = mime.lookup(slug) || 'application/octet-stream';

		res.writeHead(200, {'Content-Type': imgMime});
		res.end(imgBuf, 'binary');
	});
};