'use strict';

const	logPrefix	= 'larvitimages: controllers/serveDbImages.js - ',
	crypto	= require('crypto'),
	async	= require('async'),
	mime	= require('mime-types'),
	path	= require('path'),
	fs	= require('fs');

function generateEtag(path) {
	let	stats;

	if ( ! fs.existsSync(path)) return false;

	try {
		stats	= fs.statSync(path);
		return crypto.createHash('md5').update(stats.mtime.toString() + stats.size.toString() + stats.ino.toString()).digest('hex');
	} catch (err) {
		req.log.warn(logPrefix + 'generateEtag() - Failed to generate etag for file "' + path + '": ' + err.message);
		return false;
	}
}

function run(req, res) {
	const	slug	= path.parse(req.urlParsed.pathname).base,
		tasks	= [];

	let	responseSent	= false,
		imgMime;

	if (req.headers && req.headers['if-none-match'] !== undefined) {
		tasks.push(function (cb) {
			req.imgLib.getImages({'slugs': [slug]}, function (err, images) {
				let	imagePath,
					image;

				if (err) {
					req.log.warn(logPrefix + err.message);
					return cb();
				}

				if (Object.keys(images).length === 0) return cb();

				image	= images[Object.keys(images)[0]];

				if (req.urlParsed.query.width !== undefined || req.urlParsed.query.height !== undefined) {
					let	pathToFile	= req.imgLib.getPathToImage(image.uuid, true);

					pathToFile += image.uuid;

					if (req.urlParsed.query.width) pathToFile += ('_w' + req.urlParsed.query.width);
					if (req.urlParsed.query.height) pathToFile += ('_h' + req.urlParsed.query.height);

					pathToFile += ('.' + image.type);

					if (fs.existsSync(pathToFile)) {
						imagePath	= pathToFile;
					}
				}

				if ( ! imagePath) {
					imagePath	= req.imgLib.getPathToImage(image.uuid, false) + slug;
				}

				if (generateEtag(imagePath) === req.headers['if-none-match']) {
					res.writeHead(304, 'Not Modified');
					res.end();
					responseSent	= true;
				}

				cb();
			});
		});
	}

	tasks.push(function (cb) {
		if (responseSent) return cb();

		req.imgLib.getImageBin({'slug': slug, 'width': req.urlParsed.query.width, 'height': req.urlParsed.query.height}, function (err, imgBuf, filePath) {
			if (err) {
				req.log.info('larvitimages: controllers/serveDbImages.js - slug: "' + slug + '" err from req.imgLib.getImageBin(): ' + err.message);
				res.writeHead(500, {'Content-Type': 'text/plain' });
				res.end('Something is funky with this image, the server got sad. :(');
				return cb(err);
			}

			if ( ! imgBuf) {
				res.writeHead(404, {'Content-Type': 'text/plain' });
				res.end('File not found');
				return cb();
			}

			const header = {};
			imgMime	= mime.lookup(slug) || 'application/octet-stream';

			if (req.urlParsed.query.cacheControl) {
				header['Cache-Control'] = req.urlParsed.query.cacheControl.split(',');
			} else {
				header['Cache-Control'] = ['public', 'max-age=900'];
			}

			try {
				const	stats	= fs.statSync(filePath);
				header['Last-Modified'] = stats.mtime;
				header['ETag'] = generateEtag(filePath);
			} catch (err) {
				req.log.warn(logPrefix + 'Failed to read stats from file "' + filePath + '": ' + err.message);
			}

			header['Content-Length'] = imgBuf.length;
			header['Content-Type'] = imgMime;
			res.writeHead(200, header);
			res.end(imgBuf, 'binary');
			cb();
		});
	});

	async.series(tasks);
};

module.exports = run;
module.exports.run = run;
