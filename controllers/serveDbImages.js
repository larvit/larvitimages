'use strict';

const	mime	= require('mime-types'),
	logPrefix 	= 'larvitimages: controllers/serveDbImages.js - ',
	path	= require('path'),
	async	= require('async'),
	log	= require('winston'),
	img	= require('larvitimages'),
	crypto	= require('crypto'),
	fs	= require('fs');

function generateEtag(path, stats) {
	if ( ! path || ! stats) return '';
	return crypto.createHash('md5').update(stats.mtime.toString() + stats.size.toString() + stats.ino.toString()).digest('hex');
}

exports.run = function (req, res) {
	const	slug	= path.parse(req.urlParsed.pathname).base,
		tasks	= [];

	let	imgMime,
		responseSent = false,
		stats;

	if (req.headers && req.headers['if-none-match'] !== undefined) {

		tasks.push(function (cb) {
			img.getImages({'slugs': [slug]}, function (err, images) {
				let image,
					imagePath;
				
				if (err) {
					log.warn(logPrefix + err.message);
					return cb();
				}
				
				if (Object.keys(images).length === 0) return cb();

				image = images[Object.keys(images)[0]];

				if (req.urlParsed.query.width !== undefined || req.urlParsed.query.height !== undefined) {
					let pathToFile = img.getPathToImage(image.uuid, true);

					pathToFile += image.uuid;

					if (req.urlParsed.query.width) pathToFile += ('_w' + req.urlParsed.query.width);
					if (req.urlParsed.query.height) pathToFile += ('_h' + req.urlParsed.query.height);

					pathToFile += ('.' + image.type);

					if (fs.existsSync(pathToFile)) {
						imagePath = pathToFile;
					}
				}

				if ( ! imagePath) {
					imagePath = img.getPathToImage(image.uuid, false) + slug;
				}

				stats = fs.statSync(imagePath);

				if (generateEtag(imagePath, stats) === req.headers['if-none-match']) {
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
	
		img.getImageBin({'slug': slug, 'width': req.urlParsed.query.width, 'height': req.urlParsed.query.height}, function (err, imgBuf, filePath) {

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

			res.setHeader('Last-Modified', stats.mtime);
			res.setHeader('Cache-Control', ['public', 'max-age=900']);
			res.setHeader('ETag', generateEtag(filePath, stats));

			res.setHeader('Content-Length', imgBuf.length);
			res.writeHead(200, {'Content-Type': imgMime});
			res.end(imgBuf, 'binary');
			cb();
		});
	});

	async.series(tasks);
};
