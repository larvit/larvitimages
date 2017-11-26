'use strict';

const	mime	= require('mime-types'),
	logPrefix 	= 'larvitimages: controllers/serveDbImages.js - ',
	path	= require('path'),
	async	= require('async'),
	log	= require('winston'),
	img	= require('larvitimages');

exports.run = function (req, res) {
	const	slug	= path.parse(req.urlParsed.pathname).base,
		tasks	= [];

	let	imgMime,
		responseSent = false;

	if (req.headers && req.headers['if-none-match'] !== undefined) {

		tasks.push(function (cb) {
			img.getImages({'slugs': [slug]}, function (err, images) {
				if (err) {
					log.warn(logPrefix + err.message);
					return cb();
				}
				
				if (Object.keys(images).length === 0) return cb();

				if (images[Object.keys(images)[0]].etag === req.headers['if-none-match']) {
					res.writeHead(304, 'Not Modified');
					res.end();
					responseSent = true;
				}

				cb();
			});
		});
	}

	tasks.push(function (cb) {
		if (responseSent) return cb();
	
		img.getImageBin({'slug': slug, 'width': req.urlParsed.query.width, 'height': req.urlParsed.query.height}, function (err, imgBuf, img) {
			let etag = img.etag;

			if (err) {
				log.info('larvitimages: controllers/serveDbImages.js - slug: "' + slug + '" err from img.getImageBin(): ' + err.message);
				res.writeHead(500, {'Content-Type': 'text/plain' });
				res.end('Something is funky with this image, the server got sad. :(');
				return cb(err);
			}

			if ( ! imgBuf) {
				res.writeHead(404, {'Content-Type': 'text/plain' });
				res.end('File not found');
				return cb();
			}

			imgMime = mime.lookup(slug) || 'application/octet-stream';

			if (etag) {
				if (req.urlParsed.query.height) etag += req.urlParsed.query.height;
				if (req.urlParsed.query.width)	etag += req.urlParsed.query.width;
				res.setHeader('Cache-Control', ['public', 'max-age=3600']);
				res.setHeader('Expires', new Date(Date.now() + 3600000).toUTCString());
				res.setHeader('ETag', etag);
			}

			res.setHeader('Content-Length', imgBuf.length);
			res.writeHead(200, {'Content-Type': imgMime});
			res.end(imgBuf, 'binary');
			cb();
		});
	});

	async.series(tasks);
};
