'use strict';

const	mime	= require('mime-types'),
	path	= require('path'),
	log	= require('winston'),
	img	= require('larvitimages');

exports.run = function (req, res) {
	const	slug	= path.parse(req.urlParsed.pathname).base;

	let	imgMime;
	img.getImageBin({'slug': slug, 'width': req.urlParsed.query.width, 'height': req.urlParsed.query.height}, function (err, imgBuf) {
		if (err) {
			log.info('larvitimages: controllers/serveDbImages.js - slug: "' + slug + '" err from img.getImageBin(): ' + err.message);
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
